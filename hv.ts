import type { Candle } from "./tecnica";

/** Volatilidade histórica anualizada (desvio-padrão dos retornos log) em janelas móveis de `janela` pregões. */
export function hvSerie(candles: Candle[], janela = 21): number[] {
  const ret: number[] = [];
  for (let i = 1; i < candles.length; i++) ret.push(Math.log(candles[i]!.fechamento / candles[i - 1]!.fechamento));
  const out: number[] = [];
  for (let i = janela; i <= ret.length; i++) {
    const w = ret.slice(i - janela, i);
    const m = w.reduce((a, b) => a + b, 0) / janela;
    const v = w.reduce((a, b) => a + (b - m) ** 2, 0) / (janela - 1);
    out.push(Math.sqrt(v * 252));
  }
  return out;
}

export const MIN_OBS_HV = 60;

/**
 * HV Rank e HV Percentil (0..1) da volatilidade de 21 pregões nos últimos 252 pregões.
 * É um substituto do IV Rank/Percentil enquanto o banco não tem 60+ pregões de IV das opções.
 */
export function hvMetricas(candles: Candle[]): { rank: number; percentil: number; atual: number; dias: number } | null {
  const s = hvSerie(candles).slice(-252);
  if (s.length < MIN_OBS_HV) return null;
  const atual = s[s.length - 1]!;
  const lo = Math.min(...s), hi = Math.max(...s);
  return { rank: hi > lo ? (atual - lo) / (hi - lo) : 0.5, percentil: s.filter((v) => v < atual).length / s.length, atual, dias: s.length };
}
