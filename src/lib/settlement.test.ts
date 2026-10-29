import { describe, expect, it } from "vitest";
import { liquidarVencidos, precoNoVencimento, resultadoNoVencimento } from "./settlement";

const candle = (dia: string, fechamento: number) => ({ momento: `${dia}T13:00:00.000Z`, fechamento });
const hist = [candle("2026-10-14", 30), candle("2026-10-15", 31.5), candle("2026-10-16", 33), candle("2026-10-19", 34)];

describe("precoNoVencimento", () => {
  it("usa o fechamento da data do vencimento", () => {
    expect(precoNoVencimento(hist, "2026-10-16")).toEqual({ preco: 33, data: "2026-10-16" });
  });
  it("usa o último pregão antes do vencimento quando a data é feriado", () => {
    expect(precoNoVencimento(hist, "2026-10-17")).toEqual({ preco: 33, data: "2026-10-16" });
  });
  it("devolve null enquanto o histórico não cobre o vencimento", () => {
    expect(precoNoVencimento(hist, "2026-10-20")).toBeNull();
    expect(precoNoVencimento(null, "2026-10-16")).toBeNull();
    expect(precoNoVencimento([{ momento: "x", fechamento: 10 }], "2026-10-16")).toBeNull();
  });
  it("não usa um pregão distante do vencimento", () => {
    expect(precoNoVencimento([candle("2026-09-01", 30), candle("2026-10-19", 34)], "2026-10-16")).toBeNull();
  });
});

describe("resultadoNoVencimento", () => {
  const venda = [{ tipo: "PUT", lado: "venda", qtd: 1, preco: 0.8, strike: 32 }];
  it("put vendida fica com o prêmio se o ativo fecha acima do strike", () => {
    expect(resultadoNoVencimento(venda, 33)).toBe(80);
  });
  it("put vendida perde a diferença abaixo do strike", () => {
    expect(resultadoNoVencimento(venda, 30)).toBe(-120);
  });
  it("trava de alta com calls respeita lucro e perda máximos", () => {
    const trava = [
      { tipo: "CALL", lado: "compra", qtd: 1, preco: 1.5, strike: 30 },
      { tipo: "CALL", lado: "venda", qtd: 1, preco: 0.5, strike: 34 },
    ];
    expect(resultadoNoVencimento(trava, 40)).toBe(300);
    expect(resultadoNoVencimento(trava, 20)).toBe(-100);
  });
  it("devolve null para pernas inválidas", () => {
    expect(resultadoNoVencimento([{ tipo: "X" }], 30)).toBeNull();
    expect(resultadoNoVencimento("lixo", 30)).toBeNull();
  });
});

// Banco falso: registra updates e só deixa o primeiro update de cada sinal "ativo" ter efeito.
function bancoFalso(sinais: Record<string, unknown>[], historico: unknown) {
  const updates: Record<string, unknown>[] = [];
  const inseridos: Record<string, unknown>[] = [];
  const ativos = new Set(sinais.map((s) => s["id"]));
  const builder = (tabela: string) => {
    const state: { op: string; patch?: Record<string, unknown>; id?: unknown } = { op: "select" };
    const api: Record<string, unknown> = {
      select: () => api, eq: (c: string, v: unknown) => { if (c === "id") state.id = v; return api; }, lt: () => api, in: () => api, limit: () => api,
      update: (patch: Record<string, unknown>) => { state.op = "update"; state.patch = patch; return api; },
      insert: (rows: Record<string, unknown>[]) => { inseridos.push(...rows); return Promise.resolve({ error: null }); },
      then: (ok: (v: unknown) => unknown) => {
        if (tabela === "sinais" && state.op === "select") return ok({ data: sinais, error: null });
        if (tabela === "ativos") return ok({ data: [{ ticker: "PETR4", historico_precos: historico }], error: null });
        if (tabela === "sinais" && state.op === "update") {
          const efetivo = ativos.delete(state.id);
          if (efetivo) updates.push({ id: state.id, ...state.patch });
          return ok({ data: efetivo ? [{ id: state.id }] : [], error: null });
        }
        return ok({ data: [], error: null });
      },
    };
    return api;
  };
  return { db: { from: builder }, updates, inseridos };
}

describe("liquidarVencidos", () => {
  const sinal = { id: 1, ticker: "PETR4", estrategia: "venda_put", score: 80, vencimento: "2026-10-16", pernas: [{ tipo: "PUT", lado: "venda", qtd: 1, preco: 0.8, strike: 32 }] };
  const agora = new Date("2026-10-20T15:00:00Z");

  it("grava resultado e preço de vencimento, gera alerta e é idempotente", async () => {
    const { db, updates, inseridos } = bancoFalso([sinal], hist);
    expect(await liquidarVencidos(db, { agora })).toEqual({ liquidados: 1, pendentes: 0 });
    expect(updates[0]).toMatchObject({ id: 1, status: "encerrado", motivo_encerramento: "vencimento", preco_vencimento: 33, resultado: 80 });
    expect(inseridos).toHaveLength(1);
    expect(await liquidarVencidos(db, { agora })).toEqual({ liquidados: 0, pendentes: 0 });
    expect(updates).toHaveLength(1);
    expect(inseridos).toHaveLength(1);
  });

  it("mantém aberto, sem inventar resultado, enquanto não há preço do vencimento", async () => {
    const { db, updates } = bancoFalso([{ ...sinal, vencimento: "2026-10-19" }], [candle("2026-10-15", 31)]);
    expect(await liquidarVencidos(db, { agora })).toEqual({ liquidados: 0, pendentes: 1 });
    expect(updates).toHaveLength(0);
  });
});
