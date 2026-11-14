import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, RefreshCw, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { asArr, corValor, desatualizado, fmtBRL, fmtDate, fmtDateTime, fmtNum, fmtPct, haQuanto, nomeEstrategia, type Perna } from "@/lib/format";
import { normalizarPernas } from "@/lib/payoff";
import { useAgora } from "@/hooks/use-agora";
import { Pernas } from "@/components/radar/Pernas";
import { ScoreBadge, Tag } from "@/components/radar/Tags";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/carteira")({
  head: () => ({
    meta: [
      { title: "Minha carteira — Radar de Opções B3" },
      { name: "description", content: "Acompanhe suas entradas, lucro ou prejuízo e a evolução das operações com opções." },
      { property: "og:title", content: "Minha carteira — Radar de Opções B3" },
      { property: "og:description", content: "Acompanhe suas entradas, lucro ou prejuízo e a evolução das operações com opções." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CarteiraPage,
});

type Posicao = Tables<"carteira">;

function CarteiraPage() {
  const agora = useAgora();
  const q = useQuery({
    queryKey: ["carteira", "minhas-operacoes"],
    queryFn: async () => {
      const { data, error } = await supabase.from("carteira").select("*").order("entrada_em", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const posicoes = q.data ?? [];
  const resultado = posicoes.reduce((total, p) => total + Number(p.resultado), 0);
  const lucrando = posicoes.filter((p) => Number(p.resultado) > 0).length;
  const perdendo = posicoes.filter((p) => Number(p.resultado) < 0).length;
  const ultima = posicoes.reduce<string | null>((max, p) => !max || p.atualizado_em > max ? p.atualizado_em : max, null);

  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight"><Wallet className="text-primary" />Minha carteira</h1>
        <p className="text-sm text-muted-foreground">Entradas preservadas · valores por lote de 100 · atualizadas após cada coleta válida</p>
      </div>
      <Button variant="ghost" onClick={() => q.refetch()} disabled={q.isFetching}><RefreshCw className={q.isFetching ? "animate-spin" : ""} />Atualizar carteira</Button>
    </div>

    {q.isLoading ? <div className="grid gap-4 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-lg border bg-card" />)}</div> : q.isError ? (
      <p role="alert" className="text-loss">Não foi possível carregar sua carteira: {(q.error as Error).message}</p>
    ) : <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Resumo label="Resultado total" value={fmtBRL(resultado)} className={corValor(resultado)} />
        <Resumo label="Operações" value={String(posicoes.length)} />
        <Resumo label="Lucrando" value={String(lucrando)} className="text-gain" />
        <Resumo label="Perdendo" value={String(perdendo)} className="text-loss" />
      </div>
      {posicoes.length > 0 && <p className="text-xs text-muted-foreground">Última marcação {haQuanto(ultima, agora)}. Resultados sem custos, emolumentos ou dividendos.</p>}
      {!posicoes.length ? <div className="rounded-lg border border-dashed p-10 text-center">
        <Wallet className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
        <h2 className="font-semibold">Sua carteira está vazia</h2>
        <p className="mt-1 text-sm text-muted-foreground">No Radar, clique em “Entrar” na operação que deseja acompanhar.</p>
        <Link to="/radar" className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline">Abrir Radar<ArrowRight className="h-4 w-4" /></Link>
      </div> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{posicoes.map((p) => <PosicaoCard key={p.id} p={p} agora={agora} />)}</div>}
    </>}
  </div>;
}

function Resumo({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return <div className="rounded-lg border bg-card p-4"><p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p><p className={`num mt-1 text-2xl font-semibold ${className}`}>{value}</p></div>;
}

function PosicaoCard({ p, agora }: { p: Posicao; agora: number }) {
  const pernas = normalizarPernas(p.pernas);
  const velho = p.cobertura !== "vencimento" && desatualizado(p.atualizado_em, agora);
  const entrada = Number(p.credito_debito_entrada);
  const atual = p.premio_atual == null ? null : Number(p.premio_atual);
  const cobertura = {
    entrada: "resultado desde a entrada",
    completa: "cotação completa",
    parcial: "último resultado preservado",
    vencimento: "resultado no vencimento",
    sem_preco: "fechamento indisponível",
  }[p.cobertura] ?? p.cobertura;
  return <article className={`rounded-lg border bg-card p-4 ${velho ? "opacity-60" : ""}`}>
    <div className="flex items-start gap-3">
      <ScoreBadge score={p.score_atual ?? p.score_entrada} apagado={velho || !p.sinal_ativo} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><span className="num text-lg font-semibold">{p.ticker}</span>{!p.sinal_ativo && <Tag tone="warn">fora do Radar</Tag>}{p.preco_estimado && <Tag tone="warn">estimado</Tag>}</div>
        <p className="truncate text-sm text-muted-foreground">{nomeEstrategia(p.estrategia)} · venc. {fmtDate(p.vencimento)}</p>
      </div>
    </div>
    <div className="mt-3 rounded-md bg-background/60 p-2"><p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Estrutura e prêmios da entrada</p><Pernas pernas={asArr<Perna>(pernas)} compact /></div>
    <dl className="num mt-3 grid grid-cols-3 gap-x-2 gap-y-3 text-xs">
      <Kpi l="Resultado / lote" v={fmtBRL(Number(p.resultado))} c={corValor(p.resultado)} />
      <Kpi l="Retorno" v={fmtPct(p.retorno_pct, 1)} c={corValor(p.resultado)} />
      <Kpi l="Score entrada → atual" v={`${fmtNum(p.score_entrada)} → ${fmtNum(p.score_atual)}`} />
      <Kpi l={entrada >= 0 ? "Crédito na entrada" : "Débito na entrada"} v={fmtBRL(Math.abs(entrada))} c={corValor(entrada)} />
      <Kpi l="Prêmio atual" v={atual == null ? "—" : fmtBRL(Math.abs(atual))} />
      <Kpi l="Prob. entrada → atual" v={`${fmtPct(p.prob_lucro_entrada)} → ${fmtPct(p.prob_lucro_atual)}`} />
      <Kpi l="Ativo na entrada" v={fmtBRL(p.preco_ativo_entrada)} />
      <Kpi l="Ativo atual" v={fmtBRL(p.preco_ativo_atual)} />
      <Kpi l="Perda máx. entrada" v={fmtBRL(p.perda_max_entrada)} c="text-loss" />
    </dl>
    <div className="mt-4 border-t pt-3 text-xs text-muted-foreground">
      <p>Entrada em {fmtDateTime(p.entrada_em)} · 1 lote de 100</p>
      <p className="mt-1">{cobertura} · atualizado {haQuanto(p.atualizado_em, agora)}</p>
    </div>
  </article>;
}

function Kpi({ l, v, c = "" }: { l: string; v: string; c?: string }) {
  return <div className="min-w-0"><dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{l}</dt><dd className={`truncate font-semibold ${c}`}>{v}</dd></div>;
}
