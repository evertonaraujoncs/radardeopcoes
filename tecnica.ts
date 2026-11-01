/**
 * Análise técnica do ATIVO (nunca da opção), conforme o método: tendência por médias 20/50/200,
 * IFR 14, estocástico lento e suporte/resistência por pivôs. Lógica pura, sem I/O.
 */
import { diaSP } from "./settlement";

export interface Candle { data: string; maxima: number; minima: number; fechamento: number; volume: number | null }
export type Tendencia = "alta" | "baixa" | "lateral" | "indefinida";

export interface AnaliseTecnica {
  tendencia: Tendencia;
  sinais_alta: string[];
  sinais_baixa: string[];
  ifr: number | null;
  estocastico: { k: number; d: number } | null;
  suporte: number | null;
  resistencia: number | null;
  preco: number;
  candles: number;
}

export const MIN_CANDLES = 60;
export const SINAIS_MINIMOS = 3; // "mínimo 3 sinais na mesma direção antes de qualquer entrada"

/** Converte ativos.historico_precos (Yahoo, ordem cronológica) em candles válidos. */
export function candlesDe(historico: unknown): Candle[] {
  if (!Array.isArray(historico)) return [];
  return historico.flatMap((c) => {
    const r = c as Record<string, unknown> | null;
    if (!r || typeof r["momento"] !== "string" || Number.isNaN(Date.parse(r["momento"]))) return [];
    const fechamento = Number(r["fechamento"]);
    if (!Number.isFinite(fechamento) || fechamento <= 0) return [];
    const maxima = Number.isFinite(Number(r["maxima"])) && r["maxima"] != null ? Number(r["maxima"]) : fechamento;
    const minima = Number.isFinite(Number(r["minima"])) && r["minima"] != null ? Number(r["minima"]) : fechamento;
    const volume = r["volume"] != null && Number.isFinite(Number(r["volume"])) ? Number(r["volume"]) : null;
    return [{ data: diaSP(r["momento"]), maxima: Math.max(maxima, fechamento), minima: Math.min(minima, fechamento), fechamento, volume }];
  }).sort((a, b) => a.data.localeCompare(b.data));
}

export function sma(valores: number[], n: number, deslocamento = 0): number | null {
  const fim = valores.length - deslocamento;
  if (fim < n) return null;
  let s = 0;
  for (let i = fim - n; i < fim; i++) s += valores[i]!;
  return s / n;
}

/** IFR de Wilder (14). */
export function ifr(fechamentos: number[], n = 14): number | null {
  if (fechamentos.length < n + 1) return null;
  let ganho = 0, perda = 0;
  for (let i = 1; i <= n; i++) {
    const d = fechamentos[i]! - fechamentos[i - 1]!;
    if (d >= 0) ganho += d; else perda -= d;
  }
  ganho /= n; perda /= n;
  for (let i = n + 1; i < fechamentos.length; i++) {
    const d = fechamentos[i]! - fechamentos[i - 1]!;
    ganho = (ganho * (n - 1) + Math.max(d, 0)) / n;
    perda = (perda * (n - 1) + Math.max(-d, 0)) / n;
  }
  return perda === 0 ? 100 : 100 - 100 / (1 + ganho / perda);
}

/** Estocástico lento (14, 3, 3): %K suavizado e sua média %D. */
export function estocasticoLento(c: Candle[], n = 14, suavK = 3, suavD = 3): { k: number; d: number } | null {
  if (c.length < n + suavK + suavD) return null;
  const rapido: number[] = [];
  for (let i = n - 1; i < c.length; i++) {
    const janela = c.slice(i - n + 1, i + 1);
    const hh = Math.max(...janela.map((x) => x.maxima)), ll = Math.min(...janela.map((x) => x.minima));
    rapido.push(hh === ll ? 50 : (100 * (c[i]!.fechamento - ll)) / (hh - ll));
  }
  const media = (v: number[], m: number) => v.map((_, i) => (i + 1 < m ? NaN : v.slice(i + 1 - m, i + 1).reduce((a, b) => a + b, 0) / m)).filter(Number.isFinite);
  const k = media(rapido, suavK);
  const d = media(k, suavD);
  return k.length && d.length ? { k: k[k.length - 1]!, d: d[d.length - 1]! } : null;
}

type Dir = "alta" | "baixa" | "lado";
function direcaoMedia(fech: number[], n: number, janela: number): Dir | null {
  const agora = sma(fech, n), antes = sma(fech, n, janela);
  if (agora === null || antes === null) return null;
  const v = agora / antes - 1;
  return v > 0.002 ? "alta" : v < -0.002 ? "baixa" : "lado";
}

/** Pivôs de 5 candles de cada lado: suporte = maior fundo abaixo do preço; resistência = menor topo acima. */
export function suporteResistencia(c: Candle[], preco: number, lado = 5, olhar = 120): { suporte: number | null; resistencia: number | null } {
  const base = c.slice(-olhar);
  const fundos: number[] = [], topos: number[] = [];
  for (let i = lado; i < base.length - lado; i++) {
    const w = base.slice(i - lado, i + lado + 1);
    if (base[i]!.minima === Math.min(...w.map((x) => x.minima))) fundos.push(base[i]!.minima);
    if (base[i]!.maxima === Math.max(...w.map((x) => x.maxima))) topos.push(base[i]!.maxima);
  }
  const abaixo = fundos.filter((f) => f < preco), acima = topos.filter((t) => t > preco);
  const recente = base.slice(-60);
  return {
    suporte: abaixo.length ? Math.max(...abaixo) : recente.length ? Math.min(...recente.map((x) => x.minima)) : null,
    resistencia: acima.length ? Math.min(...acima) : recente.length ? Math.max(...recente.map((x) => x.maxima)) : null,
  };
}

export function analisarTecnica(candles: Candle[]): AnaliseTecnica | null {
  if (candles.length < MIN_CANDLES) return null;
  const fech = candles.map((c) => c.fechamento);
  const preco = fech[fech.length - 1]!;
  const alta: string[] = [], baixa: string[] = [];
  const mm = { mm20: direcaoMedia(fech, 20, 5), mm50: direcaoMedia(fech, 50, 10), mm200: direcaoMedia(fech, 200, 20) };
  for (const [nome, dir] of [["MM20", mm.mm20], ["MM50", mm.mm50], ["MM200", mm.mm200]] as const) {
    if (dir === "alta") alta.push(`${nome} apontada para cima`);
    if (dir === "baixa") baixa.push(`${nome} apontada para baixo`);
  }
  const rsi = ifr(fech);
  if (rsi !== null) { if (rsi > 50) alta.push(`IFR 14 acima de 50 (${rsi.toFixed(0)})`); else if (rsi < 50) baixa.push(`IFR 14 abaixo de 50 (${rsi.toFixed(0)})`); }
  const est = estocasticoLento(candles);
  if (est) { if (est.k > est.d) alta.push("Estocástico lento acima da média"); else if (est.k < est.d) baixa.push("Estocástico lento abaixo da média"); }

  let tendencia: Tendencia = "indefinida";
  if (alta.length >= SINAIS_MINIMOS && alta.length > baixa.length) tendencia = "alta";
  else if (baixa.length >= SINAIS_MINIMOS && baixa.length > alta.length) tendencia = "baixa";
  else if (mm.mm20 === "lado" && mm.mm50 !== "alta" && mm.mm50 !== "baixa") tendencia = "lateral";
  const { suporte, resistencia } = suporteResistencia(candles, preco);
  return { tendencia, sinais_alta: alta, sinais_baixa: baixa, ifr: rsi, estocastico: est, suporte, resistencia, preco, candles: candles.length };
}
