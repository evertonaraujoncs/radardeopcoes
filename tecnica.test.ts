import { describe, expect, it } from "vitest";
import { analisarTecnica, candlesDe, estocasticoLento, ifr, sma, suporteResistencia, type Candle } from "./tecnica";

function serie(n: number, f: (i: number) => number): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10);
    const c = f(i);
    return { data: d, maxima: c * 1.01, minima: c * 0.99, fechamento: c, volume: 1000 };
  });
}

describe("indicadores", () => {
  it("sma e IFR", () => {
    expect(sma([1, 2, 3, 4, 5], 5)).toBe(3);
    expect(sma([1, 2, 3], 5)).toBeNull();
    expect(ifr(Array.from({ length: 40 }, (_, i) => 10 + i))).toBe(100);
    expect(ifr(Array.from({ length: 40 }, (_, i) => 50 - i))!).toBeLessThan(5);
  });
  it("estocástico lento em alta fica acima de 50", () => {
    const e = estocasticoLento(serie(60, (i) => 20 + i * 0.1));
    expect(e!.k).toBeGreaterThan(50);
  });
});

describe("tendência", () => {
  it("alta: médias para cima, IFR>50 e estocástico confirmam", () => {
    const a = analisarTecnica(serie(250, (i) => 20 + i * 0.05 + Math.sin(i / 3) * 0.2))!;
    expect(a.tendencia).toBe("alta");
    expect(a.sinais_alta.length).toBeGreaterThanOrEqual(3);
  });
  it("baixa", () => {
    const a = analisarTecnica(serie(250, (i) => 60 - i * 0.1 + Math.sin(i / 3) * 0.2))!;
    expect(a.tendencia).toBe("baixa");
  });
  it("lateral: média de 20 plana", () => {
    const a = analisarTecnica(serie(250, (i) => 30 + Math.sin(i / 4) * 0.01))!;
    expect(["lateral", "indefinida"]).toContain(a.tendencia);
  });
  it("sem histórico mínimo devolve null", () => {
    expect(analisarTecnica(serie(30, () => 20))).toBeNull();
  });
});

describe("suporte/resistência e candles", () => {
  it("acha o fundo e o topo mais próximos do preço", () => {
    const c = serie(120, (i) => 30 + 3 * Math.sin(i / 6));
    const preco = c[c.length - 1]!.fechamento;
    const sr = suporteResistencia(c, preco);
    expect(sr.suporte!).toBeLessThan(preco);
    expect(sr.resistencia!).toBeGreaterThan(preco);
  });
  it("candlesDe ignora linhas inválidas e ordena", () => {
    const r = candlesDe([{ momento: "2026-01-02T13:00:00Z", fechamento: 10, maxima: 11, minima: 9 }, { momento: "x", fechamento: 5 }, { momento: "2026-01-01T13:00:00Z", fechamento: 9 }]);
    expect(r.map((c) => c.fechamento)).toEqual([9, 10]);
  });
});
