import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import {
  asArr, corValor, desatualizado, ESTRATEGIAS, fmtBRL, fmtDate, fmtNum, fmtPct, haQuanto, nomeEstrategia, type Perna,
} from "@/lib/format";
import { useAgora } from "@/hooks/use-agora";
import { Pernas } from "@/components/radar/Pernas";
import { MotivosRiscos, ScoreBadge, Tag } from "@/components/radar/Tags";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/radar")({
  head: () => ({
    meta: [
      { title: "Radar — Radar de Opções B3" },
      { name: "description", content: "Sinais ativos de estruturas com opções ordenados por score." },
      { property: "og:title", content: "Radar — Radar de Opções B3" },
      { property: "og:description", content: "Sinais ativos de estruturas com opções ordenados por score." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RadarPage,
});

type Sinal = Tables<"sinais">;

const sel = "h-9 rounded-md border border-input bg-background px-2 text-sm";

function RadarPage() {
  const qc = useQueryClient();
  const agora = useAgora();
  const [novos, setNovos] = useState<Set<number>>(new Set());
  const conhecidos = useRef<Set<number> | null>(null);
  const [f, setF] = useState({ ativo: "", estrategia: "", vencimento: "", prob: "", rr: "" });

  const q = useQuery({
    queryKey: ["sinais", "ativos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sinais").select("*").eq("status", "ativo").order("score", { ascending: false }).limit(500);
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!q.data) return;
    const ids = new Set(q.data.map((s) => s.id));
    if (conhecidos.current) {
      const n = [...ids].filter((id) => !conhecidos.current!.has(id));
      if (n.length) {
        setNovos((prev) => new Set([...prev, ...n]));
        setTimeout(() => setNovos((prev) => { const c = new Set(prev); n.forEach((x) => c.delete(x)); return c; }), 60000);
      }
    }
    conhecidos.current = ids;
  }, [q.data]);

  useEffect(() => {
    const ch = supabase.channel("radar-sinais")
      .on("postgres_changes", { event: "*", schema: "public", table: "sinais" }, () =>
        qc.invalidateQueries({ queryKey: ["sinais"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const sinais = q.data ?? [];
  const ativos = useMemo(() => [...new Set(sinais.map((s) => s.ticker))].sort(), [sinais]);
  const vencs = useMemo(() => [...new Set(sinais.map((s) => s.vencimento))].sort(), [sinais]);
  const ultima = useMemo(() => sinais.reduce<string | null>((m, s) => (!m || s.atualizado_em > m ? s.atualizado_em : m), null), [sinais]);

  const filtrados = sinais.filter((s) =>
    (!f.ativo || s.ticker === f.ativo) &&
    (!f.estrategia || s.estrategia === f.estrategia) &&
    (!f.vencimento || s.vencimento === f.vencimento) &&
    (!f.prob || Number(s.prob_lucro ?? 0) >= Number(f.prob) / 100) &&
    (!f.rr || Number(s.retorno_sobre_risco ?? 0) >= Number(f.rr.replace(",", "."))));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Radar</h1>
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gain opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-gain" />
            </span>
            Dados atualizados {haQuanto(ultima, agora)} · {filtrados.length} de {sinais.length} sinais
            {desatualizado(ultima, agora) && sinais.length > 0 && <Tag tone="warn">desatualizado</Tag>}
          </p>
        </div>
        <button onClick={() => q.refetch()} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <RefreshCw className={`h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} /> Atualizar
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 rounded-lg border bg-card p-3">
        <div className="space-y-1"><Label className="text-xs">Ativo</Label>
          <select className={sel + " w-full"} value={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.value })}>
            <option value="">Todos</option>{ativos.map((a) => <option key={a}>{a}</option>)}
          </select></div>
        <div className="space-y-1"><Label className="text-xs">Estratégia</Label>
          <select className={sel + " w-full"} value={f.estrategia} onChange={(e) => setF({ ...f, estrategia: e.target.value })}>
            <option value="">Todas</option>{Object.entries(ESTRATEGIAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
        <div className="space-y-1"><Label className="text-xs">Vencimento</Label>
          <select className={sel + " w-full"} value={f.vencimento} onChange={(e) => setF({ ...f, vencimento: e.target.value })}>
            <option value="">Todos</option>{vencs.map((v) => <option key={v} value={v}>{fmtDate(v)}</option>)}
          </select></div>
        <div className="space-y-1"><Label className="text-xs">Prob. mínima (%)</Label>
          <Input inputMode="numeric" placeholder="ex.: 60" value={f.prob} onChange={(e) => setF({ ...f, prob: e.target.value })} /></div>
        <div className="space-y-1"><Label className="text-xs">Retorno/risco mín.</Label>
          <Input inputMode="decimal" placeholder="ex.: 0,30" value={f.rr} onChange={(e) => setF({ ...f, rr: e.target.value })} /></div>
      </div>

      {q.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="h-64 rounded-lg border bg-card animate-pulse" />)}</div>
      ) : q.error ? (
        <p className="text-loss">Erro ao carregar sinais: {(q.error as Error).message}</p>
      ) : filtrados.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          {sinais.length === 0 ? "Nenhum sinal ativo. Assim que o robô gravar sinais, eles aparecem aqui em tempo real." : "Nenhum sinal com esses filtros."}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtrados.map((s) => <SinalCard key={s.id} s={s} novo={novos.has(s.id)} agora={agora} />)}
        </div>
      )}
    </div>
  );
}

function SinalCard({ s, novo, agora }: { s: Sinal; novo: boolean; agora: number }) {
  const velho = desatualizado(s.atualizado_em, agora);
  const destaque = novo && !velho;
  const be = asArr<number>(s.breakevens);
  return (
    <Link to="/sinal/$id" params={{ id: String(s.id) }}
      className={`group block rounded-lg border bg-card p-4 transition hover:border-primary/60 ${destaque ? "glow animate-flash" : ""} ${velho ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-3">
        <ScoreBadge score={s.score} apagado={velho} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="num text-lg font-semibold">{s.ticker}</span>
            {destaque && <Tag tone="warn">NOVO</Tag>}
            {velho && <Tag tone="warn">desatualizado</Tag>}
          </div>
          <p className="text-sm text-muted-foreground truncate">{nomeEstrategia(s.estrategia)} · venc. {fmtDate(s.vencimento)}{s.dias_vencimento != null && ` (${s.dias_vencimento}d)`}</p>
        </div>
      </div>
      <div className="mt-3 rounded-md bg-background/60 p-2"><Pernas pernas={asArr<Perna>(s.pernas)} compact /></div>
      <dl className="num mt-3 grid grid-cols-3 gap-2 text-xs">
        <Kpi l={Number(s.credito_debito) >= 0 ? "Crédito" : "Débito"} v={fmtBRL(Math.abs(Number(s.credito_debito ?? 0)))} c={corValor(s.credito_debito)} />
        <Kpi l="Lucro máx." v={s.lucro_max == null ? "ilimitado" : fmtBRL(s.lucro_max)} c="text-gain" />
        <Kpi l="Perda máx." v={s.perda_max == null ? "ilimitada" : fmtBRL(s.perda_max)} c="text-loss" />
        <Kpi l="Prob. lucro" v={fmtPct(s.prob_lucro)} />
        <Kpi l="Ret./risco" v={fmtNum(s.retorno_sobre_risco)} />
        <Kpi l="Breakeven" v={be.length ? be.map((b) => fmtNum(b)).join(" / ") : "—"} />
      </dl>
      <div className="mt-3"><MotivosRiscos motivos={s.motivos} riscos={s.riscos} /></div>
    </Link>
  );
}

function Kpi({ l, v, c = "" }: { l: string; v: string; c?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground font-sans">{l}</dt>
      <dd className={`truncate font-semibold ${c}`}>{v}</dd>
    </div>
  );
}
