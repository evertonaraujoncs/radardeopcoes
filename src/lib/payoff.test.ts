import { describe, expect, it } from "vitest";
import { curvaPayoff, normalizarPernas, payoffNoVencimento } from "./payoff";

describe("payoff no vencimento", () => {
  const pernas = normalizarPernas([
    { tipo: "call", lado: "compra", strike: 38, preco: 1.2 },
    { tipo: "call", lado: "venda", strike: 40, preco: 0.55 },
  ]);
  it("aceita o formato recebido no sinal de teste sem perder a quantidade", () => {
    expect(pernas).toHaveLength(2);
    expect(pernas.map((p) => [p.tipo, p.lado, p.qtd])).toEqual([["CALL", 1, 1], ["CALL", -1, 1]]);
  });
  it("calcula perda, equilíbrio e lucro por lote", () => {
    expect(payoffNoVencimento(pernas, 37)).toBeCloseTo(-65);
    expect(payoffNoVencimento(pernas, 38.65)).toBeCloseTo(0);
    expect(payoffNoVencimento(pernas, 40)).toBeCloseTo(135);
    expect(payoffNoVencimento(pernas, 45)).toBeCloseTo(135);
  });
  it("inclui strikes e breakeven e não produz valores inválidos", () => {
    const curva = curvaPayoff(pernas, 39.1, [38.65]);
    expect(curva.some(([s]) => s === 38)).toBe(true);
    expect(curva.some(([s]) => s === 40)).toBe(true);
    expect(curva.some(([s]) => s === 38.65)).toBe(true);
    expect(curva.every(([s, p]) => Number.isFinite(s) && Number.isFinite(p))).toBe(true);
  });
  it("não transforma pernas inválidas em operações reais", () => {
    expect(normalizarPernas([{ tipo: "call", lado: "indefinido", strike: 38, preco: 1 }])).toEqual([]);
    expect(curvaPayoff([], 39)).toEqual([]);
  });
  it("preserva o formato numérico original e o payoff de puts e ações", () => {
    const put = normalizarPernas([{ tipo: "PUT", lado: -1, qtd: 2, ticker: "PETRX", strike: 38, preco: 1 }]);
    expect(payoffNoVencimento(put, 38)).toBe(200);
    expect(payoffNoVencimento(put, 36)).toBe(-200);
    const acao = normalizarPernas([{ tipo: "ACAO", lado: 1, qtd: 1, preco: 39 }]);
    expect(payoffNoVencimento(acao, 40)).toBe(100);
  });
});