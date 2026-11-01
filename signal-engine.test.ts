import { describe, expect, it } from "vitest";
import {
  analisarPayoff, avaliar, bsGregas, bsPreco, calcularAlertas, diasUteis, gerarSinais,
  ivImplicita, ivMetricas, ivRankSerie, pnl, probLucro, gerarEstruturas, prepararOpcoes, PARAMS_PADRAO, SCORE_PRE_VALIDACAO, type Ctx, type LinhaGrade, type Perna, type Sinal,
} from "./signal-engine";
import type { AnaliseTecnica } from "./tecnica";

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

const tecnica = (tendencia: AnaliseTecnica["tendencia"], n = 5): AnaliseTecnica => ({
  tendencia, sinais_alta: tendencia === "alta" ? Array(n).fill("sinal") : [], sinais_baixa: tendencia === "baixa" ? Array(n).fill("sinal") : [],
  ifr: 60, estocastico: { k: 70, d: 60 }, suporte: 35.5, resistencia: 41.5, preco: S0, candles: 250,
});
const ctxBase: Ctx = { q: 0, valuation_score: 70, sentimento: 0.2, datas_com: [], datas_balanco: [], ivr: 0.15, ivp: 0.2, tecnica: tecnica("alta") };
const hoje = new Date("2026-10-17T00:00:00Z");
const vencMensal = new Date("2026-11-20T00:00:00Z"); // terceira sexta de novembro; 25 dias úteis

describe("geração de sinais (método)", () => {
  it("compra de call a seco compra uma única call ao ask, com perda limitada ao prêmio de 100 unidades", async () => {
    const params = { ...PARAMS_PADRAO, estrategias_ativas: ["compra_call" as const], prob_lucro_min: 0 };
    const linhas = cadeiaSintetica(hoje, vencMensal);
    const opcoes = prepararOpcoes(linhas, S0, hoje, r, 0, params);
    const estruturas = [...gerarEstruturas("PETR4", S0, opcoes, new Set(params.estrategias_ativas))];
    expect(estruturas.length).toBeGreaterThan(0);
    for (const [estrategia, , pernas] of estruturas) {
      expect(estrategia).toBe("compra_call");
      expect(pernas).toHaveLength(1);
      const perna = pernas[0];
      if (!perna) throw new Error("Call ausente");
      expect(perna.preco).toBe(opcoes.find(o => o.ticker === perna.ticker)?.ask);
      const payoff = analisarPayoff(pernas);
      expect(payoff.lucro_max).toBeNull();
      expect(payoff.perda_max).toBeCloseTo(perna.preco, 9);
    }
    expect([...gerarEstruturas("PETR4", S0, opcoes, new Set())]).toEqual([]);
    const sinais = await gerarSinais("PETR4", S0, linhas, ctxBase, params, hoje, r);
    expect(sinais.length).toBeGreaterThan(0);
    for (const sinal of sinais) {
      expect(sinal.lucro_max).toBeNull();
      expect(sinal.credito_debito).toBeCloseTo(-sinal.perda_max, 6);
      expect(sinal.riscos).toContain("perda_total_premio");
    }
    expect(await gerarSinais("PETR4", S0, linhas, ctxBase, { ...params, capital: 1, risco_max_pct: 2 }, hoje, r)).toEqual([]);
  });

  it("só gera estruturas de débito com retorno/risco >= 3 (regra de 1/4), plano de saída e sem trava de crédito", async () => {
    const linhas = cadeiaSintetica(hoje, vencMensal);
    const params = { ...PARAMS_PADRAO, capital: 100000 };
    const sinais = await gerarSinais("PETR4", S0, linhas, ctxBase, params, hoje, r);
    expect(sinais.length).toBeGreaterThan(0);
    expect(new Set(sinais.map(s => s.chave)).size).toBe(sinais.length);
    for (const s of sinais) {
      expect(["trava_alta_call"]).toContain(s.estrategia); // alta + volatilidade barata: só compra de prêmio na direção
      expect(s.retorno_sobre_risco!).toBeGreaterThanOrEqual(3 - 1e-9);
      expect(s.score).toBeLessThanOrEqual(100);
      expect(s.curva_payoff).toHaveLength(60);
      expect(Object.keys(s.fatores).sort()).toEqual(["iv_rank", "liquidez", "noticias_eventos", "prob_lucro", "retorno_risco", "tecnica", "valuation"]);
      expect(s.plano?.stop_ativo).toBe(35.5);
      expect(s.plano?.alvo_ativo).toBe(41.5);
      expect(s.plano?.desmontar_ate).toBe("2026-11-18");
      expect(s.riscos).not.toContain("iv_sem_historico");
    }
    const sinais2 = await gerarSinais("PETR4", S0, linhas, ctxBase, params, hoje, r);
    expect(sinais2.map(s => s.chave)).toEqual(sinais.map(s => s.chave));
    expect([...gerarEstruturas("PETR4", S0, prepararOpcoes(linhas, S0, hoje, r, 0, params), new Set(["trava_alta_put", "trava_baixa_call", "iron_condor"]))]).toEqual([]);
  });

  it("volatilidade cara só permite vender prêmio; na faixa do meio não opera; sem histórico vira pré-sinal", async () => {
    const linhas = cadeiaSintetica(hoje, vencMensal);
    const params = { ...PARAMS_PADRAO, capital: 100000, prob_lucro_min: 0.4 };
    const caro = await gerarSinais("PETR4", S0, linhas, { ...ctxBase, ivr: 0.8, ivp: 0.9 }, params, hoje, r);
    expect(caro.length).toBeGreaterThan(0);
    expect(caro.every(s => ["venda_put", "lancamento_coberto"].includes(s.estrategia))).toBe(true);
    expect(caro.find(s => s.estrategia === "venda_put")?.plano?.garantia).toBeGreaterThan(0);
    expect(await gerarSinais("PETR4", S0, linhas, { ...ctxBase, ivr: 0.4, ivp: 0.5 }, params, hoje, r)).toEqual([]);
    const sem = await gerarSinais("PETR4", S0, linhas, { ...ctxBase, ivr: null, ivp: null }, params, hoje, r);
    expect(sem.length).toBeGreaterThan(0);
    for (const s of sem) { expect(s.score).toBeLessThanOrEqual(SCORE_PRE_VALIDACAO); expect(s.riscos).toContain("iv_sem_historico"); }
  });

  it("respeita universo líquido, tendência do ativo e vencimentos mensais", async () => {
    const linhas = cadeiaSintetica(hoje, vencMensal);
    expect(await gerarSinais("ABCD3", S0, linhas, ctxBase, PARAMS_PADRAO, hoje, r)).toEqual([]);
    expect(await gerarSinais("PETR4", S0, linhas, { ...ctxBase, tecnica: tecnica("baixa") }, { ...PARAMS_PADRAO, estrategias_ativas: ["trava_alta_call"] }, hoje, r)).toEqual([]);
    expect(await gerarSinais("PETR4", S0, linhas, { ...ctxBase, tecnica: tecnica("indefinida") }, PARAMS_PADRAO, hoje, r)).toEqual([]);
    const semanal = cadeiaSintetica(hoje, new Date("2026-11-13T00:00:00Z")); // sexta, mas não a terceira
    expect(await gerarSinais("PETR4", S0, semanal, ctxBase, PARAMS_PADRAO, hoje, r)).toEqual([]);
  });
});

const perna = (tipo: "CALL" | "PUT", k: number, lado: number, px: number): Perna => ({
  tipo, ticker: `${tipo[0]}${k}`, strike: k, lado, qtd: 1, preco: px, iv: 0.35, negocios: 80, spread_pct: 0.02, sem_bid_ask: false, greeks: null, T: 0.1, du: 25, dias: 35,
});
const acaoPerna: Perna = { tipo: "ACAO", ticker: "PETR4", strike: null, lado: 1, qtd: 1, preco: S0, iv: null, negocios: null, spread_pct: 0, sem_bid_ask: false, greeks: null, T: null, du: null };
const venc = new Date("2026-11-20T00:00:00Z");

describe("regras do método em estruturas montadas à mão", () => {
  it("regra de 1/4: débito até 25% da distância passa; acima disso cai", () => {
    const barata = avaliar("PETR4", S0, "trava_alta_call", venc, "2026-11-20", [perna("CALL", 40, 1, 0.45), perna("CALL", 41, -1, 0.25)], ctxBase, PARAMS_PADRAO, hoje, r, 0);
    expect(barata?.retorno_sobre_risco).toBeCloseTo(4, 6);
    const cara = avaliar("PETR4", S0, "trava_alta_call", venc, "2026-11-20", [perna("CALL", 40, 1, 0.60), perna("CALL", 41, -1, 0.30)], ctxBase, PARAMS_PADRAO, hoje, r, 0);
    expect(cara).toBeNull();
  });
  it("collar: só com custo zero/crédito e preço médio abaixo do strike da put (risco travado)", () => {
    const ok = avaliar("PETR4", S0, "collar", venc, "2026-11-20", [acaoPerna, perna("PUT", 38, 1, 1.0), perna("CALL", 40, -1, 1.2)], ctxBase, PARAMS_PADRAO, hoje, r, 0);
    expect(ok?.perda_max).toBe(0);
    expect(ok!.credito_debito).toBeGreaterThan(0);
    const caro = avaliar("PETR4", S0, "collar", venc, "2026-11-20", [acaoPerna, perna("PUT", 38, 1, 1.3), perna("CALL", 40, -1, 1.0)], ctxBase, PARAMS_PADRAO, hoje, r, 0);
    expect(caro).toBeNull();
  });
  it("condor de calls igualmente espaçado, barato e em ativo lateral", () => {
    const pernas = [perna("CALL", 40, 1, 0.40), perna("CALL", 41, -1, 0.22), perna("CALL", 42, -1, 0.12), perna("CALL", 43, 1, 0.07)];
    const c = avaliar("PETR4", S0, "condor_call", venc, "2026-11-20", pernas, { ...ctxBase, tecnica: tecnica("lateral") }, PARAMS_PADRAO, hoje, r, 0);
    expect(c?.lucro_max).toBeCloseTo(100 * (1 - 0.13), 6);
    expect(avaliar("PETR4", S0, "condor_call", venc, "2026-11-20", pernas, ctxBase, PARAMS_PADRAO, hoje, r, 0)).toBeNull(); // ativo em alta: condor não
  });
});

describe("IV estimado por HV", () => {
  it("valida com HV Rank, mas avisa; sem nenhum dos dois continua pré-sinal", async () => {
    const linhas = cadeiaSintetica(hoje, vencMensal);
    const sinais = await gerarSinais("PETR4", S0, linhas, { ...ctxBase, ivFonte: "hv" }, PARAMS_PADRAO, hoje, r);
    expect(sinais.length).toBeGreaterThan(0);
    for (const s of sinais) {
      expect(s.riscos).toContain("iv_por_hv");
      expect(s.riscos).not.toContain("iv_sem_historico");
      expect(s.iv_rank).toBe(0.15);
      expect(s.motivos.some((m) => m.includes("volatilidade histórica"))).toBe(true);
    }
  });
});

describe("IV Rank e Percentil", () => {
  const rows = (n: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => Array.from({ length: 3 }, () => ({
    data_coleta: new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString(), iv: f(i), delta: 0.5,
  }))).flat();
  it("exige 60 pregões e calcula rank e percentil dos últimos 252", () => {
    expect(ivMetricas(rows(40, (i) => 0.3 + i / 100))).toBeNull();
    const m = ivMetricas(rows(80, (i) => 0.3 + i / 200))!;
    expect(m.dias).toBe(80);
    expect(m.rank).toBeCloseTo(1, 9);
    expect(m.percentil).toBeCloseTo(79 / 80, 9);
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
