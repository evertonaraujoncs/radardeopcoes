import { describe, expect, it } from "vitest";
import { brier, calibracao, CONFIG_PADRAO, paraCsv, relatorio, resultadoNoVencimentoBt, resumir, simular, spearman, type ConfigBt, type DiaBt, type Gerador, type SinalBt } from "./backtest";

const call = (preco: number, lado = 1, strike = 10, ticker = "PETRK100") => ({ tipo: "CALL" as const, ticker, strike, lado, qtd: 1, preco });
const sinal = (extra: Partial<SinalBt> = {}): SinalBt => ({ chave: "k1", estrategia: "compra_call", vencimento: "2026-11-20", score: 70, prob_lucro: 0.4, lucro_max: null, perda_max: 50, credito_debito: -50, _pernas: [call(0.5)], ...extra });
const dia = (data: string, spot: number, bid: number | null, ask: number | null = bid, ticker = "PETRK100"): DiaBt => ({
  data, spots: { PETR4: spot }, cotacoes: { PETR4: bid === null ? {} : { [ticker]: { bid, ask, ultimo: bid } } },
});
/** Gera o sinal só no primeiro dia. */
const umaVez = (s: SinalBt): Gerador => async (_a, _d, i) => (i === 0 ? [s] : []);
const cfg = (c: Partial<ConfigBt> = {}): ConfigBt => ({ ...CONFIG_PADRAO, ...c });

describe("simular: saídas", () => {
  const base = (bidsPorDia: (number | null)[], spotFinal = 12, spots?: number[]) => {
    const datas = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"];
    return datas.map((d, i) => dia(d, spots?.[i] ?? (i === 4 ? spotFinal : 10), bidsPorDia[i] ?? null));
  };

  it("alvo: sai quando o ganho atinge o múltiplo do prêmio e ainda mede o resultado mantido até o vencimento", async () => {
    const r = await simular(base([0.5, 0.7, 1.05, 1.2, 2.0]), ["PETR4"], umaVez(sinal()), cfg());
    expect(r.trades).toHaveLength(1);
    const t = r.trades[0]!;
    expect(t).toMatchObject({ motivoSaida: "alvo", saida: "2026-11-18", entrada: "2026-11-16" });
    expect(t.resultado).toBeCloseTo(55, 6); // (1,05 - 0,50) * 100
    expect(t.resultadoVencimento).toBeCloseTo(150, 6); // spot 12, strike 10: (2 - 0,50) * 100
  });

  it("stop: sai quando a perda passa de 50% da perda máxima", async () => {
    const r = await simular(base([0.5, 0.35, 0.2, 0.1, 0.05], 9), ["PETR4"], umaVez(sinal()), cfg());
    const t = r.trades[0]!;
    expect(t.motivoSaida).toBe("stop");
    expect(t.resultado).toBeCloseTo(-30, 6); // (0,20 - 0,50) * 100
    expect(t.resultadoVencimento).toBeCloseTo(-50, 6); // vence sem valor
  });

  it("tempo: sem alvo nem stop, desmonta 2 dias antes do vencimento", async () => {
    const r = await simular(base([0.5, 0.52, 0.55, 0.6, 0.6], 10.4), ["PETR4"], umaVez(sinal()), cfg());
    const t = r.trades[0]!;
    expect(t).toMatchObject({ motivoSaida: "tempo", saida: "2026-11-18" });
    expect(t.resultado).toBeCloseTo(5, 6);
  });

  it("vencimento: sem saída antes, liquida pelo valor intrínseco com o spot do vencimento", async () => {
    const r = await simular(base([0.5, 0.5, 0.5, 0.5, 0.5]), ["PETR4"], umaVez(sinal()), cfg({ desmontarDiasAntes: 0, alvoIlimitado: 100 }));
    expect(r.trades[0]).toMatchObject({ motivoSaida: "vencimento" });
    expect(r.trades[0]!.resultado).toBeCloseTo(150, 6);
  });

  it("perna vendida: o resultado tem o sinal certo e a saída recompra no ask", async () => {
    const venda = sinal({ estrategia: "venda_call", lucro_max: 50, perda_max: 200, credito_debito: 50, _pernas: [call(0.5, -1)] });
    const r = await simular(base([null, null, null, null, null]).map((d, i) => dia(d.data, 10, [0.5, 0.3, 0.14, 0.1, 0][i] ?? 0, [0.5, 0.35, 0.15, 0.1, 0][i] ?? 0)), ["PETR4"], umaVez(venda), cfg());
    const t = r.trades[0]!;
    expect(t.motivoSaida).toBe("alvo"); // 70% de 50 = 35: ganho (0,50 - 0,15) * 100 = 35
    expect(t.resultado).toBeCloseTo(35, 6);
  });

  it("custos por perna são descontados na saída gerenciada (2 operações) e no vencimento (1)", async () => {
    const r = await simular(base([0.5, 0.7, 1.05, 1.2, 2.0]), ["PETR4"], umaVez(sinal()), cfg({ custoPorPerna: 5 }));
    expect(r.trades[0]!.resultado).toBeCloseTo(45, 6);
    expect(r.trades[0]!.resultadoVencimento).toBeCloseTo(145, 6);
  });

  it("sem cotação em um dia usa o último preço conhecido e registra a marca velha", async () => {
    const r = await simular(base([0.5, null, null, null, 0.5], 10), ["PETR4"], umaVez(sinal()), cfg({ desmontarDiasAntes: 2 }));
    expect(r.trades[0]!.marcasVelhas).toBeGreaterThan(0);
  });
});

describe("simular: controle de posições", () => {
  const datas = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"];
  const dias = datas.map((d) => dia(d, 10, 0.5));

  it("o mesmo sinal não reabre depois de aberto ou encerrado", async () => {
    const sempre: Gerador = async () => [sinal()];
    const r = await simular(dias, ["PETR4"], sempre, cfg({ desmontarDiasAntes: 0, alvoIlimitado: 100 }));
    expect(r.entradas).toBe(1);
    expect(r.trades).toHaveLength(1);
  });
  it("respeita o máximo de posições abertas por ativo", async () => {
    const varios: Gerador = async (_a, _d, i) => (i === 0 ? [1, 2, 3, 4, 5].map((n) => sinal({ chave: `k${n}` })) : []);
    const r = await simular(dias, ["PETR4"], varios, cfg({ maxAbertasPorAtivo: 2 }));
    expect(r.entradas).toBe(2);
  });
  it("posição ainda aberta no fim do histórico fica de fora das métricas", async () => {
    const r = await simular(dias.slice(0, 2), ["PETR4"], umaVez(sinal()), cfg());
    expect(r.trades).toHaveLength(0);
    expect(r.abertas).toBe(1);
  });
  it("sem o vencimento no histórico, quem já saiu pelo método entra sem resultado de vencimento", async () => {
    const curto = [dia("2026-11-16", 10, 0.5), dia("2026-11-17", 10, 1.1)];
    const r = await simular(curto, ["PETR4"], umaVez(sinal()), cfg());
    expect(r.trades[0]).toMatchObject({ motivoSaida: "alvo", resultadoVencimento: null });
  });
});

describe("payoff e métricas", () => {
  it("resultado no vencimento de uma trava de alta", () => {
    const trava = [call(1.5, 1, 30, "A"), call(0.5, -1, 34, "B")];
    expect(resultadoNoVencimentoBt(trava, 40)).toBeCloseTo(300, 6);
    expect(resultadoNoVencimentoBt(trava, 20)).toBeCloseTo(-100, 6);
  });
  it("resumir: acerto, payoff, drawdown e retorno sobre risco", () => {
    const r = resumir([100, -50, 100, -100, -50, 200], [50, 50, 50, 100, 50, 100]);
    expect(r.n).toBe(6);
    expect(r.taxaAcerto).toBeCloseTo(0.5, 9);
    expect(r.soma).toBe(200);
    expect(r.maxDrawdown).toBe(150); // pico 150, vale 0... soma até aqui: 100,50,150,50,0
    expect(r.payoff).toBeCloseTo((400 / 3) / (200 / 3), 6);
    expect(resumir([]).n).toBe(0);
  });
  it("calibração por faixa, Brier e Spearman", () => {
    const prob = [0.15, 0.18, 0.55, 0.58, 0.95, 0.92], ac = [false, false, true, false, true, true];
    const c = calibracao(prob, ac);
    expect(c.map((f) => f.faixa)).toEqual(["10-20%", "50-60%", "90-100%"]);
    expect(c[1]).toMatchObject({ n: 2, realizado: 0.5 });
    expect(brier([1, 0], [true, false])).toBe(0);
    expect(brier([0.5, 0.5], [true, false])).toBeCloseTo(0.25, 9);
    expect(spearman([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [2, 4, 6, 8, 10, 12, 14, 16, 18, 20])).toBeCloseTo(1, 9);
    expect(spearman([1, 2, 3], [3, 2, 1])).toBeNull(); // poucos pontos
  });
  it("relatório e CSV", async () => {
    const datas = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"];
    const dias = [0.5, 0.7, 1.05, 1.2, 2.0].map((b, i) => dia(datas[i]!, i === 4 ? 12 : 10, b));
    const { trades } = await simular(dias, ["PETR4"], umaVez(sinal()), cfg());
    const rel = relatorio(trades);
    expect(rel.geral.gerenciado.n).toBe(1);
    expect(rel.porEstrategia["compra_call"]!.vencimento.soma).toBeCloseTo(150, 6);
    expect(rel.saidas).toEqual({ alvo: 1 });
    expect(paraCsv(trades).split("\n")[0]).toContain("motivo_saida");
  });
});
