import { describe, expect, it, vi } from "vitest";
import { parseAcao, parseOpcoes } from "./oplab";
import { selecionarIvRank } from "./signal-engine";
import { coletarOplab, OplabError } from "./oplab-collect.server";

const time = "2026-11-03T20:05:00.000Z";
const stock = { symbol: "PETR4", close: 50.71, time, iv_current: 34.65, iv_1y_rank: 51.37, iv_1y_percentile: 56.75 };
const chain = Array.from({ length: 5 }, (_, i) => ({ symbol: `PETRL${500 + i}`, category: "CALL", due_date: "2026-12-18", strike: 50 + i, time, close: 1.2, bid: 1.1, ask: 1.3, trades: 20, volume: 2000 }));
const now = Date.parse("2026-11-04T03:12:00Z");

describe("OpLab contract and rank priority", () => {
  it("uses the confirmed percentage contract, even for ranks below one percent", () => {
    expect(parseAcao(stock, "PETR4")).toMatchObject({ preco: 50.71, ivRank1y: 0.5137, ivPercentil1y: 0.5675, ivAtual: 0.3465, time });
    expect(parseAcao({ ...stock, iv_1y_rank: 0.4 }, "PETR4").ivRank1y).toBe(0.004);
  });
  it("prefers the one-year rank over local rank and accepts zero without percentile", () => {
    expect(selecionarIvRank({ iv_rank_1y: 0.5137, iv_atualizado_em: time }, 0.9, now)).toEqual({ rank: 0.5137, fonte: "oplab" });
    expect(selecionarIvRank({ iv_rank_1y: 0, iv_atualizado_em: time }, 0.9, now)).toEqual({ rank: 0, fonte: "oplab" });
  });
  it("falls back for absent, stale, future or invalid official ranks", () => {
    for (const asset of [null, { iv_rank_1y: null, iv_atualizado_em: time }, { iv_rank_1y: 0.4, iv_atualizado_em: "2026-10-01" }, { iv_rank_1y: 0.4, iv_atualizado_em: "2027-01-01" }, { iv_rank_1y: 3, iv_atualizado_em: time }]) expect(selecionarIvRank(asset, 0.8, now)).toEqual({ rank: 0.8, fonte: "historico" });
  });
  it("preserves the provider quote date and never invents Greeks or trade counts", () => {
    const rows = parseOpcoes(chain.map(row => ({ ...row, trades: undefined })), "PETR4", time);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({ data_coleta: "2026-11-03", bid: 1.1, ask: 1.3, negocios: null, delta: null, iv: null });
    expect(() => parseOpcoes(chain.map(row => ({ ...row, time: undefined })), "PETR4", time)).toThrow();
    expect(() => parseOpcoes(chain.map(row => ({ ...row, parent_symbol: "PETR3" })), "PETR4", time)).toThrow();
    expect(() => parseAcao(stock, "VALE3")).toThrow();
  });
});

function fakeDb() {
  const writes: { table: string; value: unknown }[] = [];
  const db = { from: (table: string) => ({ upsert: async (value: unknown) => { writes.push({ table, value }); return { error: null }; }, update: (value: unknown) => ({ eq: async () => { writes.push({ table, value }); return { error: null }; } }) }) };
  return { db, writes };
}
describe("OpLab collection fallback", () => {
  it("saves stock, official IV and valid chain using the provider date", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    try {
      const { db, writes } = fakeDb();
      const get = async (path: string) => path.includes("/stocks/") ? stock : path.includes("/options/") ? chain : { symbol: "PETR4", data: Array.from({ length: 80 }, (_, i) => ({ time: now - i * 86400000, close: 50 })) };
      const result = await coletarOplab(db, "PETR4", "test-only", false, get);
      expect(result).toMatchObject({ precos: true, opcoes: true, historyCount: 80, optionsCount: 5 });
      expect(writes.find(w => w.table === "ativos")?.value).toMatchObject({ iv_rank_1y: 0.5137, iv_atualizado_em: time, atualizado_em: time });
      expect(writes.find(w => w.table === "opcoes_grade")?.value).toHaveLength(5);
    } finally { vi.useRealTimers(); }
  });
  it("enables both existing alternatives after authentication or rate-limit failure without writes", async () => {
    for (const status of [401, 429]) {
      const { db, writes } = fakeDb();
      const result = await coletarOplab(db, "PETR4", "test-only", false, async () => { throw new OplabError("Unavailable", status, 120); });
      expect(result).toMatchObject({ precos: false, opcoes: false, blocked: status === 429, retrySeconds: status === 429 ? 120 : 0 });
      expect(writes).toEqual([]);
    }
  });
  it("retains the stock IV when history and options fail, allowing independent alternatives", async () => {
    const { db, writes } = fakeDb();
    const result = await coletarOplab(db, "PETR4", "test-only", false, async path => { if (path.includes("/stocks/")) return stock; throw new OplabError("Unavailable", 500); });
    expect(result).toMatchObject({ precos: false, opcoes: false, optionsCount: 0, historyCount: 0 });
    expect(writes).toHaveLength(1);
    expect(writes[0]?.value).toMatchObject({ iv_rank_1y: 0.5137 });
  });
});