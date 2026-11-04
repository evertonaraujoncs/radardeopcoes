import { describe, expect, it } from "vitest";
import { normalizarChaves, parseAcao, parseHistorico, parseOpcoes } from "./oplab";

describe("OpLab: ação e IV Rank", () => {
  it("lê preço, IV atual, rank e percentil (em %) e converte para 0..1", () => {
    const a = parseAcao(normalizarChaves({ symbol: "PETR4", name: "PETROBRAS PN", close: 30.65, time: 1573171237000, "iv-current": 28.76, "iv-1y-rank": 12.8, "iv-1y-percentile": 22.22, "iv-1y-max": 51.77 }))!;
    expect(a.preco).toBe(30.65);
    expect(a.ivRank1y).toBeCloseTo(0.128, 6);
    expect(a.ivPercentil1y).toBeCloseTo(0.2222, 6);
    expect(a.ivAtual).toBeCloseTo(0.2876, 6);
    expect(a.time).toBe(new Date(1573171237000).toISOString());
  });
  it("aceita frações e ignora ranks quando a OpLab devolve zeros", () => {
    expect(parseAcao({ close: 10, iv_current: 0.3, iv_1y_rank: 0.4, iv_1y_percentile: 0.5 })!.ivRank1y).toBeCloseTo(0.4, 9);
    const z = parseAcao({ close: 13.31, iv: 0, iv_1y_rank: 0, iv_1y_percentile: 0, iv_1y_max: 0 })!;
    expect(z.ivRank1y).toBeNull();
    expect(z.ivPercentil1y).toBeNull();
    expect(parseAcao({ symbol: "X" })).toBeNull();
  });
});

describe("OpLab: histórico", () => {
  it("converte candles e ordena", () => {
    const h = parseHistorico({ data: [{ time: 1538967600000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }, { time: 1538881200000, close: 1.2 }, { time: 1, close: 0 }] });
    expect(h).toHaveLength(2);
    expect(h[0]!.fechamento).toBe(1.2);
  });
});

describe("OpLab: opções", () => {
  const hoje = "2026-11-02";
  it("lista plana com chaves em sublinhado", () => {
    const r = parseOpcoes([
      { symbol: "PETRL300", category: "CALL", due_date: "2026-12-18T00:00:00.000Z", strike: 30.5, bid: 1.1, ask: 1.2, close: 1.15, volume: 120000 },
      { symbol: "PETRX300", category: "PUT", due_date: "2026-12-18", strike: 30, bid: 0, ask: 0.5, close: 0.4, volume: 5000, iv: 31.2, delta: -0.4 },
      { symbol: "VALEL300", category: "CALL", due_date: "2026-12-18", strike: 60, bid: 1, ask: 1.1 },
      { symbol: "PETR4", category: "Vista", close: 31 },
    ], "PETR4", hoje);
    expect(r.linhas.map((l) => l.ticker)).toEqual(["PETRL300", "PETRX300"]);
    const [call, put] = r.linhas;
    expect(call).toMatchObject({ tipo: "CALL", strike: 30.5, vencimento: "2026-12-18", bid: 1.1, ask: 1.2, ultimo: 1.15, negocios: 1200, data_coleta: hoje });
    expect(put).toMatchObject({ tipo: "PUT", bid: null, ask: null, ultimo: 0.4, iv: 31.2, delta: -0.4 }); // sem book de duas pontas: o motor usa o último com margem
  });
  it("agrupada por série (formato antigo, chaves com hífen)", () => {
    const payload = normalizarChaves({ series: { "PETRL_20261218": { name: "PETRL", "due-date": "2026-12-18", type: "CALL", PETRL300: { strike: 30.14, bid: 1.0, ask: 1.1, close: 1.05, volume: 20000, "financial-volume": 21000 } } } });
    const r = parseOpcoes(payload, "PETR4", hoje);
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0]).toMatchObject({ ticker: "PETRL300", tipo: "CALL", vencimento: "2026-12-18", strike: 30.14 });
  });
  it("resposta irreconhecível devolve os campos vistos para diagnóstico", () => {
    const r = parseOpcoes({ resultado: { foo: 1, bar: 2 } }, "PETR4", hoje);
    expect(r.linhas).toEqual([]);
    expect(r.camposNaoReconhecidos).toContain("resultado");
  });
});
