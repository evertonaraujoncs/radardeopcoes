import { createFileRoute, Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Button } from "@/components/ui/button";
import { ColetarDados } from "@/components/radar/ColetarDados";
import { Paginador } from "@/components/radar/Paginador";
import { useIsAdmin } from "@/hooks/use-is-admin";

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

const POR_PAGINA = 24;
const hojeSP = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

const sel = "h-9 rounded-md border border-input bg-background px-2 text-sm";

function RadarPage() {
  const qc = useQueryClient();
  const agora = useAgora();
  const admin = useIsAdmin();
  const [novos, setNovos] = useState<Set<number>>(new Set());
  const conhecidos = useRef<{ chave: string; ids: Set<number> } | null>(null);
  const [f, setF] = useState({ ativo: "", estrategia: "", vencimento: "", prob: "", rr: "" });
  const [pagina, setPagina] = useState(0);
  const mudarFiltro = (parcial: Partial<typeof f>) => { setF((atual) => ({ ...atual, ...parcial })); setPagina(0); };

  // Paginação e filtros no servidor: o Radar não carrega mais todos os sinais de uma vez.
  const q = useQuery({
    queryKey: ["sinais", "ativos", f, pagina],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let qy = supabase.from("sinais").select("*", { count: "exact" }).eq("status", "ativo").gte("vencimento", hojeSP());
      if (f.ativo) qy = qy.eq("ticker", f.ativo);
      if (f.estrategia) qy = qy.eq("estrategia", f.estrategia);
      if (f.vencimento) qy = qy.eq("vencimento", f.vencimento);
      const prob = Number(f.prob.replace(",", "."));
      if (f.prob && Number.isFinite(prob)) qy = qy.gte("prob_lucro", prob / 100);
      const rr = Number(f.rr.replace(",", "."));
      if (f.rr && Number.isFinite(rr)) qy = qy.gte("retorno_sobre_risco", rr);
      const { data, error, count } = await qy.order("score", { ascending: false }).order("id").range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1);
      if (error) throw error;
      return { linhas: data, total: count ?? data.length };
    },
  });

  // Opções dos filtros e horário da última atualização (leve: só 3 colunas).
  const meta = useQuery({
    queryKey: ["sinais", "meta"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sinais").select("ticker,vencimento,atualizado_em").eq("status", "ativo").gte("vencimento", hojeSP()).limit(5000);
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!q.data || q.isPlaceholderData) return;
    const chave = JSON.stringify([f, pagina]);
    const ids = new Set(q.data.linhas.map((s) => s.id));
    // Só destaca "NOVO" quando a mesma página/filtro recebe um sinal que não tinha; trocar de página não é novidade.
    if (conhecidos.current && conhecidos.current.chave === chave) {
      const n = [...ids].filter((id) => !conhecidos.current!.ids.has(id));
      if (n.length) {
        setNovos((prev) => new Set([...prev, ...n]));
        setTimeout(() => setNovos((prev) => { const c = new Set(prev); n.forEach((x) => c.delete(x)); return c; }), 60000);
      }
    }
    conhecidos.current = { chave, ids };
  }, [q.data, q.isPlaceholderData, f, pagina]);

  useEffect(() => {
    const ch = supabase.channel("radar-sinais")
      .on("postgres_changes", { event: "*", schema: "public", table: "sinais" }, () =>
        qc.invalidateQueries({ queryKey: ["sinais"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const filtrados = q.data?.linhas ?? [];
  const total = q.data?.total ?? 0;
  const ativos = useMemo(() => [...new Set((meta.data ?? []).map((s) => s.ticker))].sort(), [meta.data]);
  const vencs = useMemo(() => [...new Set((meta.data ?? []).map((s) => s.vencimento))].sort(), [meta.data]);
  const totalGeral = meta.data?.length ?? total;
  const ultima = useMemo(() => (meta.data ?? []).reduce<string | null>((m, s) => (!m || s.atualizado_em > m ? s.atualizado_em : m), null), [meta.data]);

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
            Dados atualizados {haQuanto(ultima, agora)} · {total} de {totalGeral} sinais
            {desatualizado(ultima, agora) && totalGeral > 0 && <Tag tone="warn">desatualizado</Tag>}
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <Button variant="ghost" onClick={() => q.refetch()} disabled={q.isFetching} title="Reler sinais recebidos">
            <RefreshCw className={`h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} /> Atualizar sinais
          </Button>
          {admin.data && <ColetarDados />}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 rounded-lg border bg-card p-3">
        <div className="space-y-1"><Label className="text-xs">Ativo</Label>
          <select className={sel + " w-full"} value={f.ativo} onChange={(e) => mudarFiltro({ ativo: e.target.value })}>
            <option value="">Todos</option>{ativos.map((a) => <option key={a}>{a}</option>)}
          </select></div>
        <div className="space-y-1"><Label className="text-xs">Estratégia</Label>
          <select className={sel + " w-full"} value={f.estrategia} onChange={(e) => mudarFiltro({ estrategia: e.target.value })}>
            <option value="">Todas</option>{Object.entries(ESTRATEGIAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
        <div className="space-y-1"><Label className="text-xs">Vencimento</Label>
          <select className={sel + " w-full"} value={f.vencimento} onChange={(e) => mudarFiltro({ vencimento: e.target.value })}>
            <option value="">Todos</option>{vencs.map((v) => <option key={v} value={v}>{fmtDate(v)}</option>)}
          </select></div>
        <div className="space-y-1"><Label className="text-xs">Prob. mínima (%)</Label>
          <Input inputMode="numeric" placeholder="ex.: 60" value={f.prob} onChange={(e) => mudarFiltro({ prob: e.target.value })} /></div>
        <div className="space-y-1"><Label className="text-xs">Retorno/risco mín.</Label>
          <Input inputMode="decimal" placeholder="ex.: 0,30" value={f.rr} onChange={(e) => mudarFiltro({ rr: e.target.value })} /></div>
      </div>

      {q.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="h-64 rounded-lg border bg-card animate-pulse" />)}</div>
      ) : q.error ? (
        <p className="text-loss">Erro ao carregar sinais: {(q.error as Error).message}</p>
      ) : filtrados.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          {totalGeral === 0 ? "Nenhum sinal ativo. Assim que o robô gravar sinais, eles aparecem aqui em tempo real." : "Nenhum sinal com esses filtros."}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtrados.map((s) => <SinalCard key={s.id} s={s} novo={novos.has(s.id)} agora={agora} />)}
        </div>
      )}
      {filtrados.length > 0 && (
        <Paginador pagina={pagina} total={total} porPagina={POR_PAGINA} onChange={setPagina} carregando={q.isFetching} />
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
