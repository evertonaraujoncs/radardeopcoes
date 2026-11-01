import { describe, expect, it } from "vitest";
import { hvMetricas, hvSerie } from "./hv";
import type { Candle } from "./tecnica";

const candles = (n: number, f: (i: number) => number): Candle[] => Array.from({ length: n }, (_, i) => ({
  data: new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10), maxima: f(i), minima: f(i), fechamento: f(i), volume: 1,
}));

describe("volatilidade histórica", () => {
  it("preço constante tem volatilidade zero", () => {
    expect(hvSerie(candles(40, () => 10)).every((v) => v === 0)).toBe(true);
  });
  it("volatilidade crescente no fim dá rank e percentil altos; calma no fim dá baixos", () => {
    const sobe = candles(260, (i) => 20 * (i < 230 ? 1 + 0.002 * Math.sin(i) : 1 + 0.05 * Math.sin(i * 2)));
    const a = hvMetricas(sobe)!;
    expect(a.rank).toBeGreaterThan(0.8);
    expect(a.percentil).toBeGreaterThan(0.8);
    const cai = candles(260, (i) => 20 * (i < 200 ? 1 + 0.05 * Math.sin(i * 2) : 1 + 0.001 * Math.sin(i)));
    const b = hvMetricas(cai)!;
    expect(b.rank).toBeLessThan(0.2);
    expect(b.percentil).toBeLessThan(0.2);
  });
  it("histórico curto não gera métrica", () => {
    expect(hvMetricas(candles(50, (i) => 10 + i * 0.1))).toBeNull();
  });
});
