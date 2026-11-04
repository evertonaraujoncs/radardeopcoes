import { beforeEach, describe, expect, it, vi } from "vitest";

const respostas: Record<string, unknown> = {};
vi.mock("./oplab", async (orig) => ({ ...(await orig<typeof import("./oplab")>()), oplabGet: vi.fn(async (path: string) => {
  const chave = Object.keys(respostas).find((k) => path.startsWith(k));
  if (!chave) throw new Error(`sem resposta simulada para ${path}`);
  const r = respostas[chave];
  if (r instanceof Error) throw r;
  return r;
}) }));

import { coletarOplab } from "./oplab-collect";

/** Próxima terceira sexta-feira entre 20 e 50 dias à frente (vencimento mensal válido para a coleta). */
function vencimentoMensal(): string {
  for (let d = 20; d < 55; d++) {
    const x = new Date(Date.now() + d * 86400000);
    if (x.getUTCDay() === 5 && x.getUTCDate() >= 15 && x.getUTCDate() <= 21) return x.toISOString().slice(0, 10);
  }
  throw new Error("sem terceira sexta na janela");
}

function bancoFalso() {
  const upserts: { tabela: string; linhas: unknown }[] = [];
  return { upserts, db: { from: (tabela: string) => ({ upsert: async (linhas: unknown) => { upserts.push({ tabela, linhas }); return { error: null }; } }) } };
}
const candles = (n: number) => Array.from({ length: n }, (_, i) => ({ time: Date.now() - (n - i) * 86400000, open: 30, high: 31, low: 29, close: 30 + Math.sin(i / 5), volume: 1000 }));

beforeEach(() => { for (const k of Object.keys(respostas)) delete respostas[k]; });

describe("coletarOplab", () => {
  it("salva preço, histórico, IV Rank oficial e opções mensais com bid/ask", async () => {
    const venc = vencimentoMensal();
    respostas["/market/stocks/PETR4"] = { symbol: "PETR4", name: "PETROBRAS PN", close: 31.2, iv_current: 30, iv_1y_rank: 18, iv_1y_percentile: 24, iv_1y_max: 50 };
    respostas["/market/historical/PETR4"] = { data: candles(80) };
    respostas["/market/options/PETR4"] = [
      { symbol: "PETRL300", category: "CALL", due_date: venc, strike: 30.5, bid: 1.1, ask: 1.2, close: 1.15, volume: 50000 },
      { symbol: "PETRX300", category: "PUT", due_date: venc, strike: 30, bid: 0.5, ask: 0.6, close: 0.55, volume: 30000 },
      { symbol: "PETRL301", category: "CALL", due_date: "2020-01-17", strike: 30, bid: 1, ask: 1.1 }, // fora da janela
    ];
    const { db, upserts } = bancoFalso();
    const r = await coletarOplab(db, "PETR4", { optionsOnly: false });
    expect(r).toMatchObject({ precos: true, opcoes: true, historyCount: 80, optionsCount: 2, cotacoes: 2 });
    const ativo = upserts.find((u) => u.tabela === "ativos")!.linhas as Record<string, unknown>;
    expect(ativo).toMatchObject({ ticker: "PETR4", preco: 31.2, fonte_preco: "OpLab" });
    expect(ativo["iv_rank_1y"]).toBeCloseTo(0.18, 9);
    expect(ativo["iv_percentil_1y"]).toBeCloseTo(0.24, 9);
    expect(Array.isArray(ativo["historico_precos"])).toBe(true);
    const grade = upserts.find((u) => u.tabela === "opcoes_grade")!.linhas as Record<string, unknown>[];
    expect(grade.map((l) => l["ticker"]).sort()).toEqual(["PETRL300", "PETRX300"]);
    expect(grade[0]).toMatchObject({ bid: expect.any(Number), ask: expect.any(Number), vencimento: venc });
    expect(r.warnings).toEqual([]);
  });

  it("sem histórico suficiente cai para outra fonte, mas ainda grava IV Rank e opções", async () => {
    const venc = vencimentoMensal();
    respostas["/market/stocks/VALE3"] = { symbol: "VALE3", close: 60, iv_current: 25, iv_1y_rank: 60, iv_1y_percentile: 70 };
    respostas["/market/historical/VALE3"] = { data: candles(10) };
    respostas["/market/options/VALE3"] = [{ symbol: "VALEL600", category: "CALL", due_date: venc, strike: 60.5, bid: 1, ask: 1.1, volume: 20000 }];
    const { db, upserts } = bancoFalso();
    const r = await coletarOplab(db, "VALE3", { optionsOnly: false });
    expect(r.precos).toBe(false);
    expect(r.opcoes).toBe(true);
    expect((upserts.find((u) => u.tabela === "ativos")!.linhas as Record<string, unknown>)["historico_precos"]).toBeUndefined();
    expect(r.warnings.some((w) => w.includes("Histórico OpLab"))).toBe(true);
  });

  it("resposta de opções irreconhecível vira aviso com os campos recebidos, sem derrubar a coleta", async () => {
    respostas["/market/stocks/BBAS3"] = { symbol: "BBAS3", close: 20, iv_current: 0, iv_1y_rank: 0 };
    respostas["/market/historical/BBAS3"] = { data: candles(80) };
    respostas["/market/options/BBAS3"] = { resultado: { foo: 1 } };
    const { db } = bancoFalso();
    const r = await coletarOplab(db, "BBAS3", { optionsOnly: false });
    expect(r.opcoes).toBe(false);
    expect(r.warnings.join(" ")).toContain("resultado");
    expect(r.warnings.join(" ")).toContain("IV Rank");
  });

  it("falha na cotação do ativo (ex.: token expirado) propaga o erro", async () => {
    respostas["/market/stocks/ITUB4"] = new Error("Token da OpLab inválido ou expirado");
    const { db } = bancoFalso();
    await expect(coletarOplab(db, "ITUB4", { optionsOnly: false })).rejects.toThrow("Token da OpLab");
  });
});
