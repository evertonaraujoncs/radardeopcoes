const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const n2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct0 = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 0 });
const pct1 = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });

export const fmtBRL = (v: number | null | undefined) => (v == null ? "—" : brl.format(Number(v)));
export const fmtNum = (v: number | null | undefined) => (v == null ? "—" : n2.format(Number(v)));
export const fmtPct = (v: number | null | undefined, d = 0) =>
  v == null ? "—" : (d ? pct1 : pct0).format(Number(v));
export const fmtInt = (v: number | null | undefined) =>
  v == null ? "—" : new Intl.NumberFormat("pt-BR").format(Number(v));
export const fmtDate = (v: string | null | undefined) =>
  v ? new Date(v.length === 10 ? v + "T12:00:00" : v).toLocaleDateString("pt-BR") : "—";
export const fmtDateTime = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

export function haQuanto(v: string | null | undefined, agora = Date.now()) {
  if (!v) return "nunca";
  const min = Math.max(0, Math.round((agora - new Date(v).getTime()) / 60000));
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.round(h / 24)} dias`;
}
export const desatualizado = (v: string | null | undefined, agora = Date.now()) =>
  !v || agora - new Date(v).getTime() > 24 * 3600 * 1000;

export const corValor = (v: number | null | undefined) =>
  v == null || Number(v) === 0 ? "text-foreground" : Number(v) > 0 ? "text-gain" : "text-loss";

/** Estratégias do método, selecionáveis nos Parâmetros. */
export const ESTRATEGIAS: Record<string, string> = {
  compra_call: "Compra de call a seco",
  venda_put: "Venda de put garantida",
  lancamento_coberto: "Lançamento coberto",
  collar: "Collar de alta",
  collar_baixa: "Collar de baixa",
  trava_alta_call: "Trava de alta com calls",
  trava_baixa_put: "Trava de baixa com puts",
  condor_call: "Condor de calls",
};
/** Estratégias de crédito do motor antigo: o método as proíbe; só aparecem em sinais históricos. */
const ESTRATEGIAS_LEGADAS: Record<string, string> = {
  trava_alta_put: "Trava de alta com puts (crédito)",
  trava_baixa_call: "Trava de baixa com calls (crédito)",
  iron_condor: "Iron condor (crédito)",
};
export const nomeEstrategia = (k: string) => ESTRATEGIAS[k] ?? ESTRATEGIAS_LEGADAS[k] ?? k.replace(/_/g, " ");

export const RISCOS: Record<string, string> = {
  perda_total_premio: "Pode perder todo o prêmio pago",
  dividendo_antes_vencimento: "Dividendo antes do vencimento",
  balanco_antes_vencimento: "Balanço antes do vencimento",
  preco_sem_bid_ask: "Preço sem bid/ask (não validado)",
  iv_sem_historico: "IV Rank/Percentil indisponíveis (não validado)",
  tecnica_indisponivel: "Análise técnica indisponível (não validado)",
  iv_por_hv: "IV Rank estimado pela volatilidade histórica",
  spread_largo: "Spread largo",
};
/** Riscos que significam "método ainda não validou": o sinal é um pré-sinal e não gera alerta. */
export const PENDENCIAS = ["iv_sem_historico", "tecnica_indisponivel", "preco_sem_bid_ask"];
export const ehPreSinal = (riscos: unknown) => Array.isArray(riscos) && riscos.some((r) => PENDENCIAS.includes(String(r)));
export const nomeRisco = (k: string) => RISCOS[k] ?? k.replace(/_/g, " ");

export const FATORES: Record<string, { nome: string; peso: number }> = {
  retorno_risco: { nome: "Retorno sobre risco", peso: 25 },
  tecnica: { nome: "Leitura técnica do ativo", peso: 20 },
  prob_lucro: { nome: "Probabilidade de lucro", peso: 15 },
  iv_rank: { nome: "IV Rank adequado", peso: 15 },
  liquidez: { nome: "Liquidez", peso: 10 },
  noticias_eventos: { nome: "Notícias e eventos", peso: 10 },
  valuation: { nome: "Valuation / fundamentos", peso: 5 },
};

export type Perna = { tipo: string; ticker: string; strike: number | null; lado: number; qtd: number; preco: number; iv?: number | null };
export const asArr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
