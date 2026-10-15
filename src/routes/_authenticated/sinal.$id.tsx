import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import {
  Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import {
  asArr, corValor, desatualizado, FATORES, fmtBRL, fmtDate, fmtDateTime, fmtNum, fmtPct, haQuanto, nomeEstrategia, type Perna,
} from "@/lib/format";
import { Pernas } from "@/components/radar/Pernas";
import { MotivosRiscos, ScoreBadge, Tag } from "@/components/radar/Tags";
import { Noticias } from "@/components/radar/Noticias";

export const Route = createFileRoute("/_authenticated/sinal/$id")({
  head: () => ({
    meta: [
      { title: "Detalhe do sinal — Radar de Opções B3" },
      { name: "description", content: "Payoff, evolução do score, fatores, eventos e notícias do sinal." },
      { property: "og:title", content: "Detalhe do sinal — Radar de Opções B3" },
      { property: "og:description", content: "Payoff, evolução do score, fatores, eventos e notícias do sinal." },
    ],
  }),
  component: SinalPage,
});

function payoffLocal(pernas: Perna[], S0: number): [number, number][] {
  const pnl = (S: number) => pernas.reduce((t, p) => {
    const v = p.tipo === "ACAO" ? S : p.tipo === "CALL" ? Math.max(0, S - (p.strike ?? 0)) : Math.max(0, (p.strike ?? 0) - S);
    return t + p.lado * p.qtd * (v - p.preco);
  }, 0) * 100;
  const lo = S0 * 0.75, hi = S0 * 1.25;
  return Array.from({ length: 60 }, (_, i) => { const S = lo + ((hi - lo) * i) / 59; return [S, pnl(S)]; });
}

const tt = { contentStyle: { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 } };

function SinalPage() {
  const { id } = Route.useParams();
  const sid = Number(id);

  const sinal = useQuery({
    queryKey: ["sinais", sid],
    queryFn: async () => {
      const { data, error } = await supabase.from("sinais").select("*").eq("id", sid).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const s = sinal.data;
  const ticker = s?.ticker;

  const hist = useQuery({
    queryKey: ["sinais_historico", sid],
    queryFn: async () => {
      const { data, error } = await supabase.from("sinais_historico").select("*").eq("sinal_id", sid).order("momento");
      if (error) throw error;
      return data;
    },
  });
  const eventos = useQuery({
    enabled: !!ticker,
    queryKey: ["eventos-ate", ticker, s?.vencimento],
    queryFn: async () => {
      const hoje = new Date().toISOString().slice(0, 10);
      const [ev, dv] = await Promise.all([
        supabase.from("eventos").select("*").eq("ticker", ticker!).gte("data", hoje).lte("data", s!.vencimento).order("data"),
        supabase.from("dividendos").select("*").eq("ticker", ticker!).gte("data_com", hoje).lte("data_com", s!.vencimento).order("data_com"),
      ]);
      if (ev.error) throw ev.error;
      if (dv.error) throw dv.error;
      return [
        ...ev.data.map((e) => ({ data: e.data, titulo: e.tipo.replace(/_/g, " "), desc: e.descricao })),
        ...dv.data.map((d) => ({ data: d.data_com, titulo: `Data-com ${d.tipo}`, desc: d.valor != null ? `${fmtBRL(d.valor)} por ação` : null })),
      ].sort((a, b) => a.data.localeCompare(b.data));
    },
  });

  if (sinal.isLoading) return <div className="h-96 rounded-lg border bg-card animate-pulse" />;
  if (!s) return <p className="text-muted-foreground">Sinal não encontrado. <Link to="/radar" className="text-primary underline">Voltar</Link></p>;

  const pernas = asArr<Perna>(s.pernas);
  const curvaRaw = asArr<[number, number]>(s.curva_payoff);
  const curva = (curvaRaw.length ? curvaRaw : payoffLocal(pernas, Number(s.preco_ativo ?? pernas.find((p) => p.strike)?.strike ?? 0)))
    .map(([preco, r]) => ({ preco, r, pos: Math.max(0, r), neg: Math.min(0, r) }));
  const velho = desatualizado(s.atualizado_em);
  const fat = (s.fatores ?? {}) as Record<string, number>;
  const histData = (hist.data ?? []).map((h) => ({
    t: new Date(h.momento).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
    score: h.score != null ? Number(h.score) : null,
    prob: h.prob_lucro != null ? Number(h.prob_lucro) * 100 : null,
  }));

  return (
    <div className="space-y-5">
      <Link to="/radar" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Radar</Link>

      <div className="flex flex-wrap items-center gap-4">
        <ScoreBadge score={s.score} apagado={velho} />
        <div>
          <div className="flex items-center gap-2">
            <Link to="/ativo/$ticker" params={{ ticker: s.ticker }} className="num text-2xl font-semibold hover:text-primary">{s.ticker}</Link>
            <span className="text-xl">{nomeEstrategia(s.estrategia)}</span>
            {s.status === "encerrado" && <Tag tone="loss">encerrado</Tag>}
            {velho && <Tag tone="warn">desatualizado</Tag>}
          </div>
          <p className="text-sm text-muted-foreground">Vencimento {fmtDate(s.vencimento)} · ativo a {fmtBRL(s.preco_ativo)} · atualizado {haQuanto(s.atualizado_em)}</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="lg:col-span-2 rounded-lg border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">Payoff no vencimento (por lote de 100)</h2>
          <div className="h-72">
            <ResponsiveContainer>
              <AreaChart data={curva} margin={{ left: 10, right: 10, top: 10 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="preco" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v) => fmtNum(v)} stroke="var(--muted-foreground)" fontSize={11} />
                <YAxis tickFormatter={(v) => fmtNum(v)} stroke="var(--muted-foreground)" fontSize={11} width={70} />
                <Tooltip {...tt} formatter={(v: number) => fmtBRL(v)} labelFormatter={(v: number) => `Ativo a ${fmtBRL(v)}`} />
                <ReferenceLine y={0} stroke="var(--muted-foreground)" />
                {s.preco_ativo != null && <ReferenceLine x={Number(s.preco_ativo)} stroke="var(--primary)" strokeDasharray="4 4" label={{ value: "atual", fill: "var(--primary)", fontSize: 11 }} />}
                {asArr<number>(s.breakevens).map((b) => <ReferenceLine key={b} x={b} stroke="var(--muted-foreground)" strokeDasharray="2 4" />)}
                <Area dataKey="pos" name="Ganho" stroke="var(--gain)" fill="var(--gain)" fillOpacity={0.2} isAnimationActive={false} />
                <Area dataKey="neg" name="Perda" stroke="var(--loss)" fill="var(--loss)" fillOpacity={0.2} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="rounded-lg border bg-card p-4 space-y-3">
          <h2 className="text-sm font-semibold">Estrutura</h2>
          <Pernas pernas={pernas} />
          <dl className="num grid grid-cols-2 gap-2 text-sm">
            <K l={Number(s.credito_debito) >= 0 ? "Crédito" : "Débito"} v={fmtBRL(Math.abs(Number(s.credito_debito ?? 0)))} c={corValor(s.credito_debito)} />
            <K l="Prob. lucro" v={fmtPct(s.prob_lucro)} />
            <K l="Lucro máx." v={s.lucro_max == null ? "ilimitado" : fmtBRL(s.lucro_max)} c="text-gain" />
            <K l="Perda máx." v={s.perda_max == null ? "ilimitada" : fmtBRL(s.perda_max)} c="text-loss" />
            <K l="Retorno/risco" v={fmtNum(s.retorno_sobre_risco)} />
            <K l="IV Rank" v={fmtPct(s.iv_rank)} />
            <K l="Valor esperado" v={fmtBRL(s.valor_esperado)} c={corValor(s.valor_esperado)} />
            <K l="Breakevens" v={asArr<number>(s.breakevens).map(fmtNum).join(" / ") || "—"} />
          </dl>
          <MotivosRiscos motivos={s.motivos} riscos={s.riscos} />
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="lg:col-span-2 rounded-lg border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">Evolução do score e da probabilidade</h2>
          {histData.length < 2 ? <p className="text-sm text-muted-foreground py-10 text-center">Histórico insuficiente ainda.</p> : (
            <div className="h-60">
              <ResponsiveContainer>
                <LineChart data={histData}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis dataKey="t" stroke="var(--muted-foreground)" fontSize={11} />
                  <YAxis domain={[0, 100]} stroke="var(--muted-foreground)" fontSize={11} />
                  <Tooltip {...tt} formatter={(v: number, n) => (n === "Prob. lucro" ? `${fmtNum(v)}%` : fmtNum(v))} />
                  <Line dataKey="score" name="Score" stroke="var(--primary)" dot={false} strokeWidth={2} />
                  <Line dataKey="prob" name="Prob. lucro" stroke="var(--chart-3)" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
        <section className="rounded-lg border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">Fatores do score</h2>
          <ul className="space-y-2.5">
            {Object.entries(FATORES).map(([k, { nome, peso }]) => {
              const v = fat[k];
              return (
                <li key={k}>
                  <div className="flex justify-between text-xs"><span>{nome} <span className="text-muted-foreground">({peso})</span></span>
                    <span className="num">{v == null ? "—" : `${fmtNum(v * peso)} pts`}</span></div>
                  <div className="mt-1 h-1.5 rounded bg-secondary"><div className="h-full rounded bg-primary" style={{ width: `${Math.round((v ?? 0) * 100)}%` }} /></div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">Eventos até o vencimento</h2>
          {!eventos.data?.length ? <p className="text-sm text-muted-foreground">Nenhum evento previsto.</p> : (
            <ul className="space-y-2 text-sm">
              {eventos.data.map((e, i) => (
                <li key={i} className="flex gap-3"><span className="num text-warn w-20 shrink-0">{fmtDate(e.data)}</span>
                  <span><span className="capitalize font-medium">{e.titulo}</span>{e.desc && <span className="text-muted-foreground"> — {e.desc}</span>}</span></li>
              ))}
            </ul>
          )}
        </section>
        <section className="rounded-lg border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">Notícias recentes</h2>
          <Noticias ticker={s.ticker} limite={6} />
        </section>
      </div>
      <p className="text-xs text-muted-foreground">Criado em {fmtDateTime(s.criado_em)}</p>
    </div>
  );
}

function K({ l, v, c = "" }: { l: string; v: string; c?: string }) {
  return <div><dt className="text-[10px] uppercase tracking-wider text-muted-foreground font-sans">{l}</dt><dd className={`font-semibold ${c}`}>{v}</dd></div>;
}
