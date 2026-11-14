import { describe, expect, it } from "vitest";
import { capitalBaseEntrada, marcarCarteira, marcarCarteiraNoVencimento, precoSaida, retornoCarteira, type CotacaoCarteira } from "./carteira";
import type { Perna } from "./format";

const compraCall: Perna = { tipo: "CALL", ticker: "PETRA100", strike: 30, lado: 1, qtd: 1, preco: 2 };
const vendaPut: Perna = { tipo: "PUT", ticker: "PETRP100", strike: 28, lado: -1, qtd: 1, preco: 2 };
const vencimento = "2026-12-18";
const cotacao = (overrides: Partial<CotacaoCarteira> = {}): CotacaoCarteira => ({
  ticker: "PETRA100", tipo: "CALL", strike: 30, vencimento, bid: 2.8, ask: 3, ultimo: 2.9, data_coleta: "2026-11-13", ...overrides,
});

describe("marcação da carteira", () => {
  it("call comprada de R$2 para R$3 lucra R$100 por lote", () => {
    const mark = marcarCarteira([compraCall], { PETRA100: cotacao() }, 32, vencimento);
    expect(mark?.resultado).toBeCloseTo(80); // saída no bid de 2,80
    expect(mark?.premioAtual).toBeCloseTo(-280);
    expect(mark?.pernasAtuais[0]?.preco_atual).toBe(2.8);
    expect(marcarCarteira([compraCall], { PETRA100: cotacao({ bid: 3 }) }, 32, vencimento)?.resultado).toBe(100);
  });

  it("put vendida sobe de R$2 para R$3 e perde R$100 por lote na recompra", () => {
    const put = cotacao({ ticker: "PETRP100", tipo: "PUT", strike: 28, bid: 2.8, ask: 3 });
    expect(marcarCarteira([vendaPut], { PETRP100: put }, 32, vencimento)?.resultado).toBe(-100);
  });

  it("usa último negócio como estimativa quando não há oferta de saída", () => {
    expect(precoSaida(compraCall, cotacao({ bid: null, ultimo: 2.9 }), vencimento)).toEqual({ preco: 2.9, estimado: true });
    expect(marcarCarteira([compraCall], { PETRA100: cotacao({ bid: null }) }, 32, vencimento)?.precoEstimado).toBe(true);
  });

  it("não inventa resultado quando falta uma perna ou a atribuição diverge", () => {
    expect(marcarCarteira([compraCall], {}, 32, vencimento)).toBeNull();
    expect(marcarCarteira([compraCall], { PETRA100: cotacao({ strike: 31 }) }, 32, vencimento)).toBeNull();
    expect(marcarCarteira([compraCall, vendaPut], { PETRA100: cotacao() }, 32, vencimento)).toBeNull();
  });

  it("calcula o fechamento final no vencimento sem ofertas", () => {
    expect(marcarCarteiraNoVencimento([compraCall], 32)?.resultado).toBe(0);
    expect(marcarCarteiraNoVencimento([compraCall], 35)?.resultado).toBe(300);
    expect(marcarCarteiraNoVencimento([vendaPut], 25)?.resultado).toBe(-100);
  });

  it("usa débito ou perda máxima como base do retorno", () => {
    expect(capitalBaseEntrada(-200, 500)).toBe(200);
    expect(capitalBaseEntrada(100, 500)).toBe(500);
    expect(capitalBaseEntrada(100, null)).toBeNull();
    expect(retornoCarteira(50, 200)).toBe(0.25);
    expect(retornoCarteira(50, null)).toBeNull();
  });
});
