/**
 * Motor de sinais de opções — porte fiel de motor_sinais.py para TypeScript.
 * Lógica pura (sem I/O): Black-Scholes, IV implícita, gregas, payoff,
 * geração de estruturas, probabilidade de lucro, score e alertas.
 */

export const LOTE = 100;
export const DIAS_MIN = 15;
export const DIAS_MAX = 60;
export const FAIXA_STRIKE = 0.15;
export const LARGURA_MAX = 0.10;
export const PREMIO_MIN = 0.05;
export const HAIRCUT_SEM_BID_ASK = 0.05;
export const TOP_POR_ATIVO = 15;
export const MAX_POR_ESTRATEGIA = 4;
export const MAX_CONDORS_POR_VENC = 400;
export const SCORE_MIN = 50;
export const ALERTA_SCORE = 70;
export const ALERTA_DELTA = 10;
export const DIAS_EVENTO_PROXIMO = 5;

export const PESOS = {
  prob_lucro: 0.30, retorno_risco: 0.25, iv_rank: 0.15,
  liquidez: 0.10, valuation: 0.10, noticias_eventos: 0.10,
} as const;

export type EstrategiaKey =
  | "compra_call" | "venda_put" | "lancamento_coberto" | "collar"
  | "trava_alta_put" | "trava_baixa_call" | "trava_alta_call" | "trava_baixa_put"
  | "iron_condor";

export const ESTRATEGIAS: Record<EstrategiaKey, { nome: string; vende_premio: boolean; direcao: number; ror_ref: number; risco_modo: "cenario" | "max" }> = {
  compra_call:        { nome: "Compra de call a seco",    vende_premio: false, direcao: 1, ror_ref: 1.0, risco_modo: "max" },
  venda_put:          { nome: "Venda de put garantida",   vende_premio: true,  direcao: 1,  ror_ref: 0.15, risco_modo: "cenario" },
  lancamento_coberto: { nome: "Lançamento coberto",       vende_premio: true,  direcao: 1,  ror_ref: 0.20, risco_modo: "cenario" },
  collar:             { nome: "Collar",                   vende_premio: false, direcao: 1,  ror_ref: 0.50, risco_modo: "max" },
  trava_alta_put:     { nome: "Trava de alta com puts",   vende_premio: true,  direcao: 1,  ror_ref: 0.40, risco_modo: "max" },
  trava_baixa_call:   { nome: "Trava de baixa com calls", vende_premio: true,  direcao: -1, ror_ref: 0.40, risco_modo: "max" },
  trava_alta_call:    { nome: "Trava de alta com calls",  vende_premio: false, direcao: 1,  ror_ref: 1.0,  risco_modo: "max" },
  trava_baixa_put:    { nome: "Trava de baixa com puts",  vende_premio: false, direcao: -1, ror_ref: 1.0,  risco_modo: "max" },
  iron_condor:        { nome: "Iron condor",              vende_premio: true,  direcao: 0,  ror_ref: 0.40, risco_modo: "max" },
};

export interface Params {
  capital: number | null;
  risco_max_pct: number;
  estrategias_ativas: EstrategiaKey[];
  liquidez_min_negocios: number;
  spread_max_pct: number;
  prob_lucro_min: number;
}

export const PARAMS_PADRAO: Params = {
  capital: null, risco_max_pct: 2.0,
  estrategias_ativas: Object.keys(ESTRATEGIAS) as EstrategiaKey[],
  liquidez_min_negocios: 10, spread_max_pct: 15.0, prob_lucro_min: 0.5,
};

// --------------------------------------------------------------------------
// utilitários
// --------------------------------------------------------------------------
export function clamp(x: number, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, x));
}

export function num(x: unknown): number | null {
  const v = typeof x === "string" ? Number(x.replace(",", ".")) : Number(x);
  return Number.isFinite(v) ? v : null;
}

export function normIv(x: unknown): number | null {
  const v = num(x);
  if (v === null || v <= 0) return null;
  return v > 3 ? v / 100 : v;
}

export function diasUteis(d0: Date, d1: Date): number {
  let n = 0;
  const d = new Date(d0);
  while (d < d1) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) n++;
  }
  return n;
}

function limpar<T>(o: T): T {
  if (typeof o === "number") return (Number.isFinite(o) ? o : null) as T;
  if (Array.isArray(o)) return o.map(limpar) as T;
  if (o && typeof o === "object") {
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, limpar(v)])) as T;
  }
  return o;
}

// --------------------------------------------------------------------------
// distribuição normal padrão
// --------------------------------------------------------------------------
function normCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}
function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}
function erf(x: number): number {
  // Abramowitz & Stegun 7.1.26 (erro máx. ~1.5e-7)
  const s = Math.sign(x);
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}
function normInv(p: number): number {
  // Aproximação racional de Acklam
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239e0] as const;
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1] as const;
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0, -2.549732539343734e0, 4.374664141464968e0, 2.938163982698783e0] as const;
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e0, 3.754408661907416e0] as const;
  const plow = 0.02425, phigh = 1 - plow;
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > phigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// --------------------------------------------------------------------------
// Black-Scholes, IV e gregas
// --------------------------------------------------------------------------
function d1d2(S: number, K: number, T: number, r: number, q: number, sig: number): [number, number] {
  const sd = sig * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sig * sig) * T) / sd;
  return [d1, d1 - sd];
}

export function bsPreco(S: number, K: number, T: number, r: number, q: number, sig: number, tipo: "CALL" | "PUT"): number {
  const [d1, d2] = d1d2(S, K, T, r, q, sig);
  if (tipo === "CALL") return S * Math.exp(-q * T) * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2);
  return K * Math.exp(-r * T) * normCdf(-d2) - S * Math.exp(-q * T) * normCdf(-d1);
}

export function ivImplicita(preco: number, S: number, K: number, T: number, r: number, q: number, tipo: "CALL" | "PUT"): number | null {
  let lo = 1e-3, hi = 6.0;
  if (preco < bsPreco(S, K, T, r, q, lo, tipo) - 1e-9 || preco > bsPreco(S, K, T, r, q, hi, tipo) + 1e-9) return null;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (bsPreco(S, K, T, r, q, mid, tipo) > preco) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

export interface Gregas { delta: number; gamma: number; theta: number; vega: number }

export function bsGregas(S: number, K: number, T: number, r: number, q: number, sig: number, tipo: "CALL" | "PUT"): Gregas {
  const [d1, d2] = d1d2(S, K, T, r, q, sig);
  const pdf = normPdf(d1);
  const eq = Math.exp(-q * T), er = Math.exp(-r * T);
  const gamma = eq * pdf / (S * sig * Math.sqrt(T));
  const vega = S * eq * pdf * Math.sqrt(T) / 100;
  const base = -S * eq * pdf * sig / (2 * Math.sqrt(T));
  let delta: number, theta: number;
  if (tipo === "CALL") {
    delta = eq * normCdf(d1);
    theta = base - r * K * er * normCdf(d2) + q * S * eq * normCdf(d1);
  } else {
    delta = eq * (normCdf(d1) - 1);
    theta = base + r * K * er * normCdf(-d2) - q * S * eq * normCdf(-d1);
  }
  return { delta, gamma, theta: theta / 252, vega };
}

// --------------------------------------------------------------------------
// payoff, breakevens, probabilidade
// --------------------------------------------------------------------------
export interface Perna {
  tipo: "CALL" | "PUT" | "ACAO";
  ticker: string;
  strike: number | null;
  lado: number;
  qtd: number;
  preco: number;
  iv: number | null;
  negocios: number | null;
  spread_pct: number;
  sem_bid_ask: boolean;
  greeks: Gregas | null;
  T: number | null;
  du: number | null;
  dias?: number;
}

export function pnl(pernas: Perna[], S: number): number {
  let tot = 0;
  for (const p of pernas) {
    let v: number;
    if (p.tipo === "ACAO") v = S - p.preco;
    else if (p.tipo === "CALL") v = Math.max(S - p.strike!, 0) - p.preco;
    else v = Math.max(p.strike! - S, 0) - p.preco;
    tot += p.lado * p.qtd * v;
  }
  return tot;
}

export function analisarPayoff(pernas: Perna[]) {
  const ks = [...new Set([0, ...pernas.filter(p => p.tipo !== "ACAO").map(p => p.strike!)])].sort((a, b) => a - b);
  const vals = ks.map(k => pnl(pernas, k));
  const slope = pernas.filter(p => p.tipo === "CALL" || p.tipo === "ACAO").reduce((s, p) => s + p.lado * p.qtd, 0);
  const bes = new Set<number>();
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i]!, b = ks[i + 1]!, fa = vals[i]!, fb = vals[i + 1]!;
    if (fa * fb < 0) bes.add(round6(a - fa * (b - a) / (fb - fa)));
  }
  ks.forEach((k, i) => { if (k > 0 && Math.abs(vals[i]!) < 1e-12) bes.add(round6(k)); });
  if (slope !== 0) {
    const root = ks[ks.length - 1]! - vals[vals.length - 1]! / slope;
    if (root > ks[ks.length - 1]! + 1e-9) bes.add(round6(root));
  }
  return {
    lucro_max: slope <= 0 ? Math.max(...vals) : null,
    perda_max: slope >= 0 ? Math.max(0, -Math.min(...vals)) : null,
    breakevens: [...bes].sort((a, b) => a - b),
  };
}
const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

export function riscoCenario(pernas: Perna[], S0: number): number {
  return Math.max(0, -Math.min(pnl(pernas, 0.8 * S0), pnl(pernas, 1.2 * S0)));
}

export function probLucro(pernas: Perna[], S0: number, sigma: number, T: number, r: number, q: number, bes: number[]): number {
  const mu = (r - q - 0.5 * sigma ** 2) * T, sd = sigma * Math.sqrt(T);
  const cdf = (x: number) => {
    if (x === Infinity) return 1;
    return x <= 0 ? 0 : normCdf((Math.log(x / S0) - mu) / sd);
  };
  const pts = [0, ...[...bes].sort((a, b) => a - b), Infinity];
  let p = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const lo = pts[i]!, hi = pts[i + 1]!;
    const mid = hi === Infinity ? lo + Math.max(1, lo * 0.1) : (lo + hi) / 2;
    if (pnl(pernas, mid) > 0) p += cdf(hi) - cdf(lo);
  }
  return clamp(p);
}

export function valorEsperado(pernas: Perna[], S0: number, sigma: number, T: number, r: number, q: number, n = 400): number {
  const mu = (r - q - 0.5 * sigma ** 2) * T, sd = sigma * Math.sqrt(T);
  let tot = 0;
  for (let i = 0; i < n; i++) tot += pnl(pernas, S0 * Math.exp(mu + sd * normInv((i + 0.5) / n)));
  return tot / n;
}

export function gregasLiquidas(pernas: Perna[]): Gregas {
  const tot: Gregas = { delta: 0, gamma: 0, theta: 0, vega: 0 };
  for (const p of pernas) {
    if (p.tipo === "ACAO") tot.delta += p.lado * p.qtd;
    else if (p.greeks) {
      tot.delta += p.lado * p.qtd * p.greeks.delta;
      tot.gamma += p.lado * p.qtd * p.greeks.gamma;
      tot.theta += p.lado * p.qtd * p.greeks.theta;
      tot.vega += p.lado * p.qtd * p.greeks.vega;
    }
  }
  return { delta: r2(tot.delta * LOTE), gamma: r2(tot.gamma * LOTE), theta: r2(tot.theta * LOTE), vega: r2(tot.vega * LOTE) };
}
const r2 = (x: number) => Math.round(x * 100) / 100;

export function curvaPayoff(pernas: Perna[], S0: number, n = 60): [number, number][] {
  const lo = 0.7 * S0, hi = 1.3 * S0;
  return Array.from({ length: n }, (_, i) => {
    const s = lo + (hi - lo) * i / (n - 1);
    return [r2(s), r2(pnl(pernas, s) * LOTE)];
  });
}

// --------------------------------------------------------------------------
// preparo da grade e geração de estruturas
// --------------------------------------------------------------------------
export interface LinhaGrade {
  ticker: string; tipo: string | null; strike: number | null; vencimento: string | null;
  bid: number | null; ask: number | null; ultimo: number | null;
  negocios: number | null; iv: number | null; delta: number | null; data_coleta: string;
}

export interface Opcao {
  ticker: string; tipo: "CALL" | "PUT"; strike: number; vencimento: Date; vencimentoStr: string;
  dias: number; du: number; T: number; bid: number; ask: number; negocios: number;
  spread_pct: number; sem_bid_ask: boolean; iv: number; greeks: Gregas;
}

export function prepararOpcoes(linhas: LinhaGrade[], S0: number, hoje: Date, r: number, q: number, params: Params): Opcao[] {
  const out: Opcao[] = [];
  for (const l of linhas) {
    if (!l.vencimento) continue;
    const venc = new Date(`${String(l.vencimento).slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(venc.getTime())) continue;
    const dias = Math.round((venc.getTime() - hoje.getTime()) / 86400000);
    const K = num(l.strike);
    const tipo = l.tipo;
    if (!(DIAS_MIN <= dias && dias <= DIAS_MAX) || K === null || K <= 0 || (tipo !== "CALL" && tipo !== "PUT")) continue;
    if (Math.abs(K / S0 - 1) > FAIXA_STRIKE) continue;
    const neg = num(l.negocios) ?? 0;
    if (neg < params.liquidez_min_negocios) continue;
    let bid = num(l.bid), ask = num(l.ask);
    const ult = num(l.ultimo);
    let mid: number, spread: number, sem = false;
    if (bid && ask && ask >= bid && bid > 0) {
      mid = (bid + ask) / 2;
      spread = (ask - bid) / mid;
    } else if (ult && ult > 0) {
      mid = ult; spread = params.spread_max_pct / 100; sem = true;
      bid = ult * (1 - HAIRCUT_SEM_BID_ASK); ask = ult * (1 + HAIRCUT_SEM_BID_ASK);
    } else continue;
    if (mid < PREMIO_MIN || spread * 100 > params.spread_max_pct) continue;
    const du = diasUteis(hoje, venc);
    if (du < 5) continue;
    const T = du / 252;
    const iv = ivImplicita(mid, S0, K, T, r, q, tipo) ?? normIv(l.iv);
    if (iv === null) continue;
    out.push({
      ticker: l.ticker, tipo, strike: K, vencimento: venc, vencimentoStr: String(l.vencimento).slice(0, 10),
      dias, du, T, bid: bid!, ask: ask!, negocios: neg, spread_pct: spread, sem_bid_ask: sem, iv,
      greeks: bsGregas(S0, K, T, r, q, iv, tipo),
    });
  }
  return out;
}

function leg(o: Opcao, lado: number): Perna {
  return {
    tipo: o.tipo, ticker: o.ticker, strike: o.strike, lado, qtd: 1,
    preco: lado > 0 ? o.ask : o.bid, iv: o.iv, negocios: o.negocios,
    spread_pct: o.spread_pct, sem_bid_ask: o.sem_bid_ask, greeks: o.greeks,
    T: o.T, du: o.du, dias: o.dias,
  };
}

function acao(ativo: string, S0: number): Perna {
  return { tipo: "ACAO", ticker: ativo, strike: null, lado: 1, qtd: 1, preco: S0, iv: null, negocios: null, spread_pct: 0, sem_bid_ask: false, greeks: null, T: null, du: null };
}

export function* gerarEstruturas(ativo: string, S0: number, opcoes: Opcao[], ativas: Set<string>): Generator<[EstrategiaKey, string, Perna[]]> {
  const porVenc = new Map<string, Opcao[]>();
  for (const o of opcoes) {
    const lst = porVenc.get(o.vencimentoStr) ?? [];
    lst.push(o);
    porVenc.set(o.vencimentoStr, lst);
  }
  for (const [venc, lst] of [...porVenc.entries()].sort()) {
    const C = lst.filter(o => o.tipo === "CALL").sort((a, b) => a.strike - b.strike);
    const P = lst.filter(o => o.tipo === "PUT").sort((a, b) => a.strike - b.strike);
    const pares = function* (L: Opcao[]) {
      for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
        const x = L[i]!, y = L[j]!;
        if (y.strike - x.strike > 0 && y.strike - x.strike <= LARGURA_MAX * S0) yield [x, y] as [Opcao, Opcao];
      }
    };
    if (ativas.has("compra_call"))
      for (const c of C) yield ["compra_call", venc, [leg(c, 1)]];
    if (ativas.has("venda_put"))
      for (const p of P) if (0.90 * S0 <= p.strike && p.strike <= S0) yield ["venda_put", venc, [leg(p, -1)]];
    if (ativas.has("lancamento_coberto"))
      for (const c of C) if (0.98 * S0 <= c.strike && c.strike <= 1.10 * S0) yield ["lancamento_coberto", venc, [acao(ativo, S0), leg(c, -1)]];
    if (ativas.has("collar"))
      for (const p of P) if (0.85 * S0 <= p.strike && p.strike <= 0.98 * S0)
        for (const c of C) if (1.02 * S0 <= c.strike && c.strike <= 1.15 * S0)
          yield ["collar", venc, [acao(ativo, S0), leg(p, 1), leg(c, -1)]];
    if (ativas.has("trava_alta_put"))
      for (const [a, b] of pares(P)) if (b.strike <= 1.02 * S0) yield ["trava_alta_put", venc, [leg(b, -1), leg(a, 1)]];
    if (ativas.has("trava_baixa_call"))
      for (const [a, b] of pares(C)) if (a.strike >= 0.98 * S0) yield ["trava_baixa_call", venc, [leg(a, -1), leg(b, 1)]];
    if (ativas.has("trava_alta_call"))
      for (const [a, b] of pares(C)) if (a.strike <= 1.02 * S0 && 1.02 * S0 <= b.strike * 1.02) yield ["trava_alta_call", venc, [leg(a, 1), leg(b, -1)]];
    if (ativas.has("trava_baixa_put"))
      for (const [a, b] of pares(P)) if (b.strike >= 0.98 * S0) yield ["trava_baixa_put", venc, [leg(b, 1), leg(a, -1)]];
    if (ativas.has("iron_condor")) {
      const pv = [...pares(P)].filter(([a, b]) => b.strike <= 0.97 * S0);
      const cv = [...pares(C)].filter(([a]) => a.strike >= 1.03 * S0);
      let n = 0;
      for (const [pa, pb] of pv) for (const [ca, cb] of cv) {
        if (Math.abs((pb.strike - pa.strike) - (cb.strike - ca.strike)) < 1e-9 && n < MAX_CONDORS_POR_VENC) {
          n++;
          yield ["iron_condor", venc, [leg(pb, -1), leg(pa, 1), leg(ca, -1), leg(cb, 1)]];
        }
      }
    }
  }
}

// --------------------------------------------------------------------------
// avaliação e score
// --------------------------------------------------------------------------
export interface Ctx {
  q: number;
  valuation_score: number | null;
  sentimento: number | null;
  datas_com: Date[];
  datas_balanco: Date[];
  ivr: number | null;
}

export interface Sinal {
  chave: string; ticker: string; estrategia: string; nome: string; vencimento: string;
  dias_vencimento: number; preco_ativo: number; credito_debito: number;
  lucro_max: number | null; perda_max: number; breakevens: number[];
  prob_lucro: number; retorno_sobre_risco: number | null; iv_rank: number | null; score: number;
  fatores: Record<string, number>; motivos: string[]; riscos: string[];
  dias_ate_evento: number | null;
  valor_esperado?: number; gregas?: Gregas; curva_payoff?: [number, number][];
  pernas?: unknown[];
  _pernas: Perna[]; _sigma: number; _T: number;
}

export function avaliar(ativo: string, S0: number, estrategia: EstrategiaKey, venc: Date, vencStr: string, pernas: Perna[], ctx: Ctx, params: Params, hoje: Date, r: number, q: number): Sinal | null {
  const est = ESTRATEGIAS[estrategia];
  const an = analisarPayoff(pernas);
  if (an.perda_max === null || (an.lucro_max !== null && an.lucro_max <= 0)) return null;
  const risco = est.risco_modo === "max" ? an.perda_max : riscoCenario(pernas, S0);
  if (risco <= 1e-9) return null;
  if (params.capital && risco * LOTE > params.capital * params.risco_max_pct / 100) return null;
  const opts = pernas.filter(p => p.tipo !== "ACAO");
  const sigma = opts.reduce((s, p) => s + p.iv!, 0) / opts.length;
  const T = opts[0]!.T!;
  const pop = probLucro(pernas, S0, sigma, T, r, q, an.breakevens);
  if (pop < params.prob_lucro_min) return null;
  const ror = an.lucro_max !== null ? an.lucro_max / risco : null;

  const ivr = ctx.ivr;
  const ivrC = ivr === null ? 0.5 : (est.vende_premio ? ivr : 1 - ivr);
  const negMin = Math.min(...opts.map(p => p.negocios ?? 0));
  const liq = clamp(negMin / 100) * (1 - 0.5 * clamp(Math.max(...opts.map(p => p.spread_pct)) / (params.spread_max_pct / 100)));
  const vs = ctx.valuation_score, d = est.direcao;
  const valC = vs === null || d === 0 ? 0.5 : clamp(d > 0 ? vs / 100 : 1 - vs / 100);
  const sent = ctx.sentimento;
  const newsC = sent === null || d === 0 ? 0.5 : clamp((sent * d + 1) / 2);

  const riscos: string[] = [];
  if (estrategia === "compra_call") riscos.push("perda_total_premio");
  let pen = 0;
  const prox: number[] = [];
  if (pernas.some(p => p.tipo === "CALL" && p.lado < 0)) {
    for (const dc of ctx.datas_com) {
      if (hoje < dc && dc <= venc) { riscos.push("dividendo_antes_vencimento"); pen += 0.5; prox.push(Math.round((dc.getTime() - hoje.getTime()) / 86400000)); break; }
    }
  }
  if (est.vende_premio) {
    for (const db of ctx.datas_balanco) {
      if (hoje < db && db <= venc) { riscos.push("balanco_antes_vencimento"); pen += 0.5; prox.push(Math.round((db.getTime() - hoje.getTime()) / 86400000)); break; }
    }
  }
  if (opts.some(p => p.sem_bid_ask)) riscos.push("preco_sem_bid_ask");
  if (Math.max(...opts.map(p => p.spread_pct)) > 0.5 * params.spread_max_pct / 100) riscos.push("spread_largo");
  const ne = 0.5 * newsC + 0.5 * (1 - clamp(pen));

  const fatores = {
    prob_lucro: pop,
    retorno_risco: ror === null ? 1.0 : clamp(ror / est.ror_ref),
    iv_rank: ivrC, liquidez: liq, valuation: valC, noticias_eventos: ne,
  };
  const score = 100 * (Object.keys(PESOS) as (keyof typeof PESOS)[]).reduce((s, k) => s + PESOS[k] * fatores[k], 0);

  const motivos = [`Probabilidade de lucro estimada de ${(pop * 100).toFixed(0)}%`];
  if (ror !== null) motivos.push(`Retorno sobre risco de ${ror.toFixed(2)}`);
  if (ivr !== null) motivos.push(`IV Rank ${(ivr * 100).toFixed(0)}% ` + (est.vende_premio && ivr >= 0.5 ? "favorece venda de prêmio" : !est.vende_premio && ivr < 0.5 ? "favorece compra de prêmio" : "pouco favorável à estratégia"));
  if (vs !== null && d !== 0) motivos.push("Valuation " + (valC >= 0.6 ? "favorável" : valC >= 0.4 ? "neutro" : "desfavorável") + " à direção");
  if (sent !== null && d !== 0) motivos.push("Notícias " + (newsC >= 0.6 ? "alinhadas" : newsC >= 0.4 ? "neutras" : "contrárias") + " à direção");

  const cd = -opts.reduce((s, p) => s + p.lado * p.qtd * p.preco, 0);
  return {
    chave: "", ticker: ativo, estrategia, nome: est.nome, vencimento: vencStr,
    dias_vencimento: opts[0]!.dias!, preco_ativo: S0, credito_debito: cd * LOTE,
    lucro_max: an.lucro_max === null ? null : an.lucro_max * LOTE,
    perda_max: an.perda_max * LOTE,
    breakevens: an.breakevens.map(b => r2(b)),
    prob_lucro: pop, retorno_sobre_risco: ror, iv_rank: ivr, score,
    fatores: Object.fromEntries(Object.entries(fatores).map(([k, v]) => [k, Math.round(v * 1000) / 1000])),
    motivos, riscos,
    dias_ate_evento: prox.length ? Math.min(...prox) : null,
    _pernas: pernas, _sigma: sigma, _T: T,
  };
}

export async function chaveSinal(ativo: string, estrategia: string, vencStr: string, pernas: Perna[]): Promise<string> {
  const base = [ativo, estrategia, vencStr, ...pernas.map(p => `${p.ticker}:${p.lado}:${p.qtd}`).sort()].join("|");
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(base));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 20);
}

export function selecionarTop(cands: Sinal[]): Sinal[] {
  const sorted = cands.filter(c => c.score >= SCORE_MIN).sort((a, b) => b.score - a.score);
  const porEst = new Map<string, number>();
  const out: Sinal[] = [];
  for (const c of sorted) {
    if ((porEst.get(c.estrategia) ?? 0) >= MAX_POR_ESTRATEGIA) continue;
    porEst.set(c.estrategia, (porEst.get(c.estrategia) ?? 0) + 1);
    out.push(c);
    if (out.length >= TOP_POR_ATIVO) break;
  }
  return out;
}

export function finalizar(c: Sinal, r: number, q: number): Sinal {
  const p = c._pernas, S0 = c.preco_ativo;
  c.valor_esperado = valorEsperado(p, S0, c._sigma, c._T, r, q) * LOTE;
  c.gregas = gregasLiquidas(p);
  c.curva_payoff = curvaPayoff(p, S0);
  c.pernas = limpar(p.map(x => ({
    tipo: x.tipo, ticker: x.ticker, strike: x.strike, lado: x.lado, qtd: x.qtd,
    preco: r2(x.preco), iv: x.iv === null ? null : Math.round(x.iv * 10000) / 10000,
  })));
  return c;
}

export async function gerarSinais(ativo: string, S0: number, linhas: LinhaGrade[], ctx: Ctx, params: Params, hoje: Date, r: number): Promise<Sinal[]> {
  const q = ctx.q;
  const opcoes = prepararOpcoes(linhas, S0, hoje, r, q, params);
  const cands: Sinal[] = [];
  for (const [est, venc, pernas] of gerarEstruturas(ativo, S0, opcoes, new Set(params.estrategias_ativas))) {
    const vencDate = new Date(`${venc}T00:00:00Z`);
    const c = avaliar(ativo, S0, est, vencDate, venc, pernas, ctx, params, hoje, r, q);
    if (c) {
      c.chave = await chaveSinal(ativo, est, venc, pernas);
      cands.push(c);
    }
  }
  return selecionarTop(cands).map(c => finalizar(c, r, q));
}

// --------------------------------------------------------------------------
// IV Rank
// --------------------------------------------------------------------------
export function ivRankSerie(rows: { data_coleta: string; iv: number | null; delta: number | null }[]): number | null {
  const porDia = new Map<string, number[]>();
  for (const row of rows) {
    const iv = normIv(row.iv);
    let d = num(row.delta);
    if (iv === null || d === null) continue;
    if (Math.abs(d) > 1.5) d /= 100;
    if (0.35 <= Math.abs(d) && Math.abs(d) <= 0.65) {
      const dia = row.data_coleta.slice(0, 10);
      porDia.set(dia, [...(porDia.get(dia) ?? []), iv]);
    }
  }
  const serie = [...porDia.entries()].filter(([, v]) => v.length >= 3)
    .map(([dia, v]) => [dia, mediana(v)] as [string, number]).sort((a, b) => a[0] < b[0] ? -1 : 1);
  if (serie.length < 20) return null;
  const vals = serie.map(([, v]) => v);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  return hi > lo ? (vals[vals.length - 1]! - lo) / (hi - lo) : 0.5;
}
function mediana(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

// --------------------------------------------------------------------------
// alertas
// --------------------------------------------------------------------------
export interface Alerta { chave: string; tipo: string; mensagem: string }

export function calcularAlertas(
  existentes: Map<string, { id: number; score: number | null; ticker: string; estrategia: string }>,
  novos: Map<string, Sinal>,
): { alertas: Alerta[]; encerrar: string[] } {
  const alertas: Alerta[] = [];
  const encerrar = [...existentes.keys()].filter(k => !novos.has(k));
  const fmtVenc = (v: string) => { const [, m, d] = v.split("-"); return `${d}/${m}`; };
  for (const [k, s] of novos) {
    const base = `${s.nome} em ${s.ticker} (venc. ${fmtVenc(s.vencimento)})`;
    if (!existentes.has(k)) {
      if (s.score >= ALERTA_SCORE) alertas.push({ chave: k, tipo: "novo", mensagem: `Novo sinal: ${base}, score ${s.score.toFixed(0)}, prob. de lucro ${(s.prob_lucro * 100).toFixed(0)}%.` });
    } else {
      const dScore = s.score - (existentes.get(k)!.score ?? 0);
      if (dScore >= ALERTA_DELTA) alertas.push({ chave: k, tipo: "score_subiu", mensagem: `Score subiu ${dScore.toFixed(0)} pontos: ${base}, agora ${s.score.toFixed(0)}.` });
      else if (dScore <= -ALERTA_DELTA) alertas.push({ chave: k, tipo: "score_caiu", mensagem: `Score caiu ${(-dScore).toFixed(0)} pontos: ${base}, agora ${s.score.toFixed(0)}.` });
    }
    if (s.dias_ate_evento !== null && s.dias_ate_evento <= DIAS_EVENTO_PROXIMO && s.score >= ALERTA_SCORE) {
      alertas.push({ chave: k, tipo: "evento_proximo", mensagem: `Evento em ${s.dias_ate_evento} dia(s) antes do vencimento: ${base} (${s.riscos.join(", ")}).` });
    }
  }
  for (const k of encerrar) {
    const e = existentes.get(k)!;
    if ((e.score ?? 0) >= ALERTA_SCORE) alertas.push({ chave: k, tipo: "encerrado", mensagem: `Sinal encerrado: ${e.estrategia} em ${e.ticker} deixou de valer.` });
  }
  return { alertas, encerrar };
}
