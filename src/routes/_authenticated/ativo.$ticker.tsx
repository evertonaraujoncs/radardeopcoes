import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { desatualizado, fmtBRL, fmtDate, fmtDateTime, fmtInt, fmtNum, fmtPct, haQuanto } from "@/lib/format";
import { Noticias } from "@/components/radar/Noticias";
import { Tag } from "@/components/radar/Tags";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/ativo/$ticker")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.ticker} — Radar de Opções B3` },
      { name: "description", content: `Cotação, fundamentos, IV e grade de opções de ${params.ticker}.` },
      { property: "og:title", content: `${params.ticker} — Radar de Opções B3` },
      { property: "og:description", content: `Cotação, fundamentos, IV e grade de opções de ${params.ticker}.` },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AtivoPage,
});

const normIv = (v: number | null) => (v == null ? null : Number(v) > 3 ? Number(v) / 100 : Number(v));
const sel = "h-9 rounded-md border border-input bg-background px-2 text-sm";
const tt = { contentStyle: { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 } };

function AtivoPage() {
  const { ticker } = Route.useParams();
  const [fv, setFv] = useState(""); const [ft, setFt] = useState(""); const [fl, setFl] = useState("");

  const ativo = useQuery({ queryKey: ["ativo", ticker], queryFn: async () => {
    const { data, error } = await supabase.from("ativos").select("*").eq("ticker", ticker).maybeSingle();
    if (error) throw error; return data; } });
  const fund = useQuery({ queryKey: ["fundamentos", ticker], queryFn: async () => {
    const { data, error } = await supabase.from("fundamentos").select("*").eq("ticker", ticker).order("data", { ascending: false }).limit(1);
    if (error) throw error; return data[0] ?? null; } });
  const divs = useQuery({ queryKey: ["dividendos", ticker], queryFn: async () => {
    const { data, error } = await supabase.from("dividendos").select("*").eq("ticker", ticker).order("data_com", { ascending: false }).limit(12);
    if (error) throw error; return data; } });
  const ivHist = useQuery({ queryKey: ["iv-hist", ticker], queryFn: async () => {
    const desde = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
    const { data, error } = await supabase.from("opcoes_grade").select("data_coleta,iv,delta")
      .eq("ativo", ticker).gte("data_coleta", desde).not("iv", "is", null).not("delta", "is", null).limit(20000);
    if (error) throw error;
    const por = new Map<string, number[]>();
    for (const r of data) {
      const d = Math.abs(Number(r.delta)); const iv = normIv(r.iv);
      if (iv == null || d < 0.3 || d > 0.7) continue;
      (por.get(r.data_coleta) ?? por.set(r.data_coleta, []).get(r.data_coleta)!).push(iv);
    }
    return [...por.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, xs]) => {
      const s = [...xs].sort((a, b) => a - b); return { d, iv: s[Math.floor(s.length / 2)] ?? 0 };
    });
  } });
  const grade = useQuery({ queryKey: ["grade", ticker], queryFn: async () => {
    const { data, error } = await supabase.from("opcoes_grade").select("*").eq("ativo", ticker)
      .order("data_coleta", { ascending: false }).limit(10000);
    if (error) throw error;
    const latest = new Map<string, (typeof data)[number]>();
    for (const row of data) {
      const key = `${row.ticker}:${row.vencimento}`;
      if (!latest.has(key)) latest.set(key, row);
    }
    return { data: data[0]?.data_coleta ?? null, linhas: [...latest.values()].sort((a, b) => (a.vencimento ?? "").localeCompare(b.vencimento ?? "") || Number(a.strike) - Number(b.strike)) };
  } });

  const ivr = useMemo(() => {
    const h = ivHist.data ?? []; if (h.length < 2) return null;
    const vals = h.map((x) => x.iv); const min = Math.min(...vals), max = Math.max(...vals);
    return max > min ? ((vals[vals.length - 1] ?? 0) - min) / (max - min) : null;
  }, [ivHist.data]);

  const linhas = grade.data?.linhas ?? [];
  const vencs = [...new Set(linhas.map((l) => l.vencimento).filter(Boolean))] as string[];
  const filtradas = linhas.filter((l) => (!fv || l.vencimento === fv) && (!ft || l.tipo?.toUpperCase() === ft) && (!fl || (l.negocios ?? 0) >= Number(fl)));
  const a = ativo.data; const f = fund.data;
  const velho = desatualizado(a?.atualizado_em);

  return (
    <div className="space-y-5">
      <Link to="/radar" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Radar</Link>
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="num text-3xl font-semibold">{ticker}</h1>
          <p className="text-sm text-muted-foreground">{a?.nome ?? "—"}{a?.setor && ` · ${a.setor}`}</p>
        </div>
        <div className="num text-3xl font-semibold text-primary">{fmtBRL(a?.preco)}</div>
        <p className="text-xs text-muted-foreground pb-1">atualizado {haQuanto(a?.atualizado_em)} {velho && <Tag tone="warn">desatualizado</Tag>}</p>
      </div>

      {a?.historico_precos && Array.isArray(a.historico_precos) && <section className="space-y-2">
        <h2 className="text-sm font-semibold">Histórico de preços · {a.historico_precos.length} pregões</h2>
        {a.fonte_preco && <a href={a.fonte_preco} target="_blank" rel="noreferrer" className="text-xs text-primary">Fonte: Yahoo Finance · até 1 ano</a>}
        <div className="h-52"><ResponsiveContainer><LineChart data={a.historico_precos}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="momento" tickFormatter={(v) => fmtDate(v).slice(0, 5)} stroke="var(--muted-foreground)" fontSize={11} />
          <YAxis stroke="var(--muted-foreground)" fontSize={11} domain={["auto", "auto"]} />
          <Tooltip {...tt} labelFormatter={(v: string) => fmtDate(v)} formatter={(v: number) => fmtBRL(v)} />
          <Line dataKey="fechamento" name="Fechamento" stroke="var(--primary)" dot={false} strokeWidth={2} />
        </LineChart></ResponsiveContainer></div>
      </section>}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-lg border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">Fundamentos / valuation {f && <span className="text-xs font-normal text-muted-foreground">({fmtDate(f.data)})</span>}</h2>
          <dl className="num grid grid-cols-2 gap-3 text-sm">
            <K l="P/L" v={fmtNum(f?.pl)} /><K l="P/VP" v={fmtNum(f?.pvp)} />
            <K l="Dividend yield" v={fmtPct(f?.dy, 1)} /><K l="ROE" v={fmtPct(f?.roe != null && Math.abs(Number(f.roe)) > 3 ? Number(f.roe) / 100 : f?.roe, 1)} />
            <K l="Dív. líq./EBITDA" v={fmtNum(f?.divida_liquida_ebitda)} /><K l="Valuation score" v={f?.valuation_score == null ? "—" : `${fmtInt(Math.round(Number(f.valuation_score)))}/100`} />
          </dl>
        </section>
        <section className="lg:col-span-2 rounded-lg border bg-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Histórico de IV (ATM, 12 meses)</h2>
            <span className="text-sm">IV Rank <span className="num font-semibold text-primary">{fmtPct(ivr)}</span></span>
          </div>
          {(ivHist.data?.length ?? 0) < 2 ? <p className="text-sm text-muted-foreground py-10 text-center">Histórico insuficiente.</p> : (
            <div className="h-52"><ResponsiveContainer>
              <LineChart data={ivHist.data ?? []}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="d" tickFormatter={(v) => fmtDate(v).slice(0, 5)} stroke="var(--muted-foreground)" fontSize={11} />
                <YAxis tickFormatter={(v) => fmtPct(v)} stroke="var(--muted-foreground)" fontSize={11} width={45} />
                <Tooltip {...tt} labelFormatter={(v: string) => fmtDate(v)} formatter={(v: number) => fmtPct(v, 1)} />
                <Line dataKey="iv" name="IV" stroke="var(--primary)" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer></div>
          )}
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">Dividendos</h2>
          {!divs.data?.length ? <p className="text-sm text-muted-foreground">Sem registros.</p> : (
            <Table><TableHeader><TableRow><TableHead>Data-com</TableHead><TableHead>Pagamento</TableHead><TableHead>Tipo</TableHead><TableHead className="text-right">Valor</TableHead></TableRow></TableHeader>
              <TableBody className="num">{divs.data.map((d) => (
                <TableRow key={d.id}><TableCell>{fmtDate(d.data_com)}</TableCell><TableCell>{fmtDate(d.data_pagamento)}</TableCell>
                  <TableCell className="font-sans uppercase text-xs">{d.tipo}</TableCell><TableCell className="text-right text-gain">{fmtBRL(d.valor)}</TableCell></TableRow>))}
              </TableBody></Table>
          )}
        </section>
        <section className="rounded-lg border bg-card p-4"><h2 className="mb-3 text-sm font-semibold">Notícias</h2><Noticias ticker={ticker} /></section>
      </div>

      <section className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold mr-auto">Grade de opções {grade.data?.data && <span className="text-xs font-normal text-muted-foreground">última cotação de {fmtDateTime(grade.data.data)}</span>}</h2>
          <select className={sel} value={fv} onChange={(e) => setFv(e.target.value)}><option value="">Todos vencimentos</option>{vencs.map((v) => <option key={v} value={v}>{fmtDate(v)}</option>)}</select>
          <select className={sel} value={ft} onChange={(e) => setFt(e.target.value)}><option value="">CALL e PUT</option><option>CALL</option><option>PUT</option></select>
          <Input className="w-36" inputMode="numeric" placeholder="Negócios mín." value={fl} onChange={(e) => setFl(e.target.value)} />
        </div>
        {a?.fonte_preco && <p className="mb-3 text-xs text-warn">Fonte: opcoes.net.br · último negócio por contrato, não tempo real garantido. IV, gregas e bid/ask indisponíveis na coleta pública.</p>}
        {!filtradas.length ? <p className="text-sm text-muted-foreground">Nenhuma opção.</p> : (
          <div className="max-h-[520px] overflow-auto">
            <Table><TableHeader className="sticky top-0 bg-card"><TableRow>
              <TableHead>Código</TableHead><TableHead>Cotação em</TableHead><TableHead>Tipo</TableHead><TableHead>Venc.</TableHead><TableHead className="text-right">Strike</TableHead>
              <TableHead className="text-right">Último</TableHead><TableHead className="text-right">Bid</TableHead><TableHead className="text-right">Ask</TableHead>
              <TableHead className="text-right">Negócios</TableHead><TableHead className="text-right">Volume</TableHead><TableHead className="text-right">IV</TableHead><TableHead className="text-right">Delta</TableHead>
            </TableRow></TableHeader>
              <TableBody className="num text-xs">{filtradas.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-semibold">{l.ticker}</TableCell>
                  <TableCell>{fmtDateTime(l.data_coleta)}</TableCell>
                  <TableCell className={l.tipo?.toUpperCase() === "CALL" ? "text-gain" : "text-loss"}>{l.tipo}</TableCell>
                  <TableCell>{fmtDate(l.vencimento)}</TableCell><TableCell className="text-right">{fmtNum(l.strike)}</TableCell>
                  <TableCell className="text-right">{fmtNum(l.ultimo)}</TableCell><TableCell className="text-right">{fmtNum(l.bid)}</TableCell><TableCell className="text-right">{fmtNum(l.ask)}</TableCell>
                  <TableCell className="text-right">{fmtInt(l.negocios)}</TableCell><TableCell className="text-right">{fmtInt(l.volume)}</TableCell>
                  <TableCell className="text-right">{fmtPct(normIv(l.iv), 1)}</TableCell><TableCell className="text-right">{fmtNum(l.delta)}</TableCell>
                </TableRow>))}
              </TableBody></Table>
          </div>
        )}
      </section>
    </div>
  );
}

function K({ l, v }: { l: string; v: string }) {
  return <div><dt className="text-[10px] uppercase tracking-wider text-muted-foreground font-sans">{l}</dt><dd className="font-semibold">{v}</dd></div>;
}
