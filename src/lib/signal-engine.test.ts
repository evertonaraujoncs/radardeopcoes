import { describe, expect, it } from "vitest";
import {
  analisarPayoff, bsGregas, bsPreco, calcularAlertas, diasUteis, gerarSinais,
  ivImplicita, ivRankSerie, pnl, probLucro, PARAMS_PADRAO, type LinhaGrade, type Perna, type Sinal,
} from "./signal-engine";

const S0 = 38, r = Math.log(1.10), q = 0.02, T = 0.12;

describe("Black-Scholes e IV", () => {
  it("paridade put-call e ida e volta da IV", () => {
    const c = bsPreco(S0, 40, T, r, q, 0.35, "CALL");
    const p = bsPreco(S0, 40, T, r, q, 0.35, "PUT");
    expect((c - p) - (S0 * Math.exp(-q * T) - 40 * Math.exp(-r * T))).toBeCloseTo(0, 9);
    expect(ivImplicita(c, S0, 40, T, r, q, "CALL")!).toBeCloseTo(0.35, 6);
  });
  it("gregas com sinais esperados", () => {
    const g = bsGregas(S0, 40, T, r, q, 0.35, "CALL");
    expect(g.delta).toBeGreaterThan(0);
    expect(g.delta).toBeLessThan(1);
    expect(g.gamma).toBeGreaterThan(0);
    expect(g.vega).toBeGreaterThan(0);
    expect(g.theta).toBeLessThan(0);
  });
});

const tp = (k: number, lado: number, px: number): Perna => ({
  tipo: "PUT", ticker: `P${k}`, strike: k, lado, qtd: 1, preco: px,
  iv: 0.35, negocios: 80, spread_pct: 0.02, sem_bid_ask: false, greeks: null, T: 0.12, du: 30, dias: 30,
});

describe("payoff", () => {
  it("trava de alta com puts: lucro, perda e breakeven", () => {
    const an = analisarPayoff([tp(36, -1, 1.2), tp(35, 1, 0.6)]);
    expect(an.lucro_max!).toBeCloseTo(0.6, 9);
    expect(an.perda_max!).toBeCloseTo(0.4, 9);
    expect(an.breakevens.map(b => Math.round(b * 10000) / 10000)).toEqual([35.4]);
  });
  it("lançamento coberto: ganho limitado e perda finita; call a seco: perda ilimitada", () => {
    const cc: Perna[] = [
      { tipo: "ACAO", ticker: "PETR4", strike: null, lado: 1, qtd: 1, preco: S0, iv: null, negocios: null, spread_pct: 0, sem_bid_ask: false, greeks: null, T: null, du: null },
      { tipo: "CALL", ticker: "C40", strike: 40, lado: -1, qtd: 1, preco: 1.0, iv: 0.35, negocios: 80, spread_pct: 0.02, sem_bid_ask: false, greeks: null, T: 0.12, du: 30, dias: 30 },
    ];
    const a2 = analisarPayoff(cc);
    expect(a2.lucro_max!).toBeCloseTo(3.0, 9);
    expect(a2.perda_max!).toBeCloseTo(37.0, 9);
    expect(analisarPayoff([cc[1]!]).perda_max).toBeNull();
  });
  it("probabilidade analítica próxima de Monte Carlo", () => {
    const legs = [tp(36, -1, 1.2), tp(35, 1, 0.6)];
    const an = analisarPayoff(legs);
    const pa = probLucro(legs, S0, 0.35, 0.12, r, q, an.breakevens);
    // Monte Carlo com LCG determinístico (seed 7), mesma distribuição lognormal
    let s = 7;
    const rand = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    const gauss = () => Math.sqrt(-2 * Math.log(rand())) * Math.cos(2 * Math.PI * rand());
    const mu = (r - q - 0.5 * 0.35 ** 2) * 0.12, sd = 0.35 * Math.sqrt(0.12);
    let hits = 0;
    const n = 200000;
    for (let i = 0; i < n; i++) if (pnl(legs, S0 * Math.exp(mu + sd * gauss())) > 0) hits++;
    expect(Math.abs(pa - hits / n)).toBeLessThan(0.01);
  });
});

function cadeiaSintetica(hoje: Date, venc: Date): LinhaGrade[] {
  const linhas: LinhaGrade[] = [];
  const du = diasUteis(hoje, venc);
  const Tv = du / 252;
  for (let k = Math.floor(S0 * 0.85); k <= S0 * 1.15; k += 1) {
    for (const tipo of ["CALL", "PUT"] as const) {
      const sig = 0.35 - 0.25 * (k / S0 - 1);
      const px = bsPreco(S0, k, Tv, r, 0, sig, tipo);
      if (px >= 0.06) linhas.push({
        ticker: `${tipo === "CALL" ? "PETRA" : "PETRM"}${k * 10}`, tipo, strike: k,
        vencimento: venc.toISOString().slice(0, 10), ultimo: px, bid: px * 0.98, ask: px * 1.02,
        negocios: 80, iv: sig, delta: 0.5, data_coleta: hoje.toISOString(),
      });
    }
  }
  return linhas;
}

describe("geração de sinais", () => {
  it("gera sinais estáveis e válidos em cadeia sintética", async () => {
    const hoje = new Date("2026-10-17T00:00:00Z");
    let venc = new Date(hoje.getTime() + 30 * 86400000);
    while (venc.getUTCDay() === 0 || venc.getUTCDay() === 6) venc = new Date(venc.getTime() + 86400000);
    const linhas = cadeiaSintetica(hoje, venc);
    const params = { ...PARAMS_PADRAO, capital: 100000, prob_lucro_min: 0.4 };
    const ctx = { q: 0, ivr: 0.8, valuation_score: 70, sentimento: 0.2, datas_com: [], datas_balanco: [] };
    const sinais = await gerarSinais("PETR4", S0, linhas, ctx, params, hoje, r);
    expect(sinais.length).toBeGreaterThan(0);
    expect(new Set(sinais.map(s => s.chave)).size).toBe(sinais.length);
    for (const s of sinais) {
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(100);
      expect(s.prob_lucro).toBeGreaterThanOrEqual(0);
      expect(s.prob_lucro).toBeLessThanOrEqual(1);
      expect(s.curva_payoff).toHaveLength(60);
      expect(s.perda_max).not.toBeNull();
      expect(Object.keys(s.fatores).sort()).toEqual(Object.keys({ prob_lucro: 0, retorno_risco: 0, iv_rank: 0, liquidez: 0, valuation: 0, noticias_eventos: 0 }).sort());
    }
    const sinais2 = await gerarSinais("PETR4", S0, linhas, ctx, params, hoje, r);
    expect(sinais2.map(s => s.chave)).toEqual(sinais.map(s => s.chave));
  });
});

describe("alertas e IV Rank", () => {
  it("novo, score subiu e encerrado", () => {
    const ex = new Map<string, { id: number; score: number | null; ticker: string; estrategia: string }>([
      ["a", { id: 1, score: 60, ticker: "PETR4", estrategia: "x" }],
      ["b", { id: 2, score: 80, ticker: "PETR4", estrategia: "iron_condor" }],
    ]);
    const base = { nome: "Teste", ticker: "PETR4", vencimento: "2026-11-16", prob_lucro: 0.7, riscos: [], dias_ate_evento: null };
    const nv = new Map<string, Sinal>([
      ["a", { ...base, score: 75 } as unknown as Sinal],
      ["c", { ...base, score: 72 } as unknown as Sinal],
    ]);
    const { alertas, encerrar } = calcularAlertas(ex, nv);
    expect(alertas.map(a => a.tipo).sort()).toEqual(["encerrado", "novo", "score_subiu"]);
    expect(encerrar).toEqual(["b"]);
  });
  it("IV Rank da série diária", () => {
    const rows = Array.from({ length: 28 }, (_, i) => Array.from({ length: 3 }, () => ({
      data_coleta: `2026-01-${String(i + 1).padStart(2, "0")}`, iv: 0.30 + (i + 1) / 100, delta: 0.5,
    }))).flat();
    expect(ivRankSerie(rows)!).toBeCloseTo(1.0, 9);
  });
});
