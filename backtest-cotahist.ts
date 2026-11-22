#!/usr/bin/env bun
/**
 * Backtest do motor de sinais do Radar com opções históricas da B3 (COTAHIST, gratuito).
 * Roda o motor dia a dia (sem olhar o futuro), abre os sinais, acompanha cada um até sair (alvo, stop, prazo ou vencimento)
 * e mede acerto, retorno, calibração da probabilidade e se o score ordena os resultados.
 *
 *   bun scripts/backtest-cotahist.ts COTAHIST_A2024.ZIP COTAHIST_A2025.ZIP
 *   bun scripts/backtest-cotahist.ts --baixar-anos 2024,2025 --ativos PETR4,VALE3
 *   bun scripts/backtest-cotahist.ts <arquivos> --de 2025-03-01 --alvo 0.7 --stop 0.5 --custo 5 --max-abertas 3
 *
 * Opções: --ativos A,B  --de AAAA-MM-DD  --ate AAAA-MM-DD  --passo N  --alvo 0.7  --stop 0.5  --custo R$/perna  --max-abertas N
 *         --cdi 0.14  --saida pasta  --baixar-anos 2024,2025  --baixar-meses N
 * Atenção: precisa de ~12 meses de histórico ANTES da data inicial para o IV Rank; notícias, valuation, proventos e análise técnica
 * não existem no histórico e ficam neutros. O resultado mede a lógica de preços e estruturas do motor, não o motor completo.
 */
import { createWriteStream, existsSync, mkdirSync, openSync, readSync, closeSync, writeFileSync } from "node:fs";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { join } from "node:path";
import { acumularSpot, linhaOpcao, parseLinha, UNIVERSO_COTAHIST, type LinhaGrade as LinhaCotahist, type Spots } from "../src/lib/cotahist";
import { lerLinhas } from "../src/lib/cotahist-io.server";
import { gerarSinais, ivRankSerie, PARAMS_PADRAO, ESTRATEGIAS, type Ctx, type EstrategiaKey } from "../src/lib/signal-engine";
import { CONFIG_PADRAO, paraCsv, relatorio, simular, type ConfigBt, type DiaBt, type Gerador, type Relatorio } from "../src/lib/backtest";

const args = process.argv.slice(2);
const valor = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const BASE_B3 = (process.env["B3_COTAHIST_BASE"] ?? "https://bvmf.bmfbovespa.com.br/InstDados/SerHist").replace(/\/$/, "");
const CACHE = "cotahist-cache";
const PAGINA_B3 = "https://www.b3.com.br/pt_br/market-data-e-indices/servicos-de-dados/market-data/historico/mercado-a-vista/cotacoes-historicas/";
const JANELA_BT = { diasMin: 0, diasMax: 90, faixaStrike: 0.35, premioMin: 0.05 };

async function baixar(nome: string): Promise<string | null> {
  mkdirSync(CACHE, { recursive: true });
  const destino = join(CACHE, nome);
  if (existsSync(destino)) return destino;
  try {
    const r = await fetch(`${BASE_B3}/${nome}`, { headers: { "User-Agent": "Mozilla/5.0 (radar-opcoes)" }, signal: AbortSignal.timeout(900000) });
    if (!r.ok || !r.body) { console.warn(`  ${nome}: HTTP ${r.status}`); return null; }
    await finished(Readable.fromWeb(r.body as never).pipe(createWriteStream(destino)));
    const fd = openSync(destino, "r"), b = Buffer.alloc(4); readSync(fd, b, 0, 4, 0); closeSync(fd);
    if (b.toString("latin1") !== "PK\u0003\u0004") { console.warn(`  ${nome}: o servidor não devolveu um ZIP`); return null; }
    return destino;
  } catch (e) { console.warn(`  ${nome}: ${e instanceof Error ? e.message : "falha no download"}`); return null; }
}

async function cdi(): Promise<number> {
  const v = Number(valor("--cdi") ?? process.env["CDI_ANUAL"]);
  if (Number.isFinite(v) && v > 0) return v;
  try {
    const r = await fetch("https://api.bcb.gov.br/dados/serie/bcdata.sgs.4389/dados/ultimos/1?formato=json", { signal: AbortSignal.timeout(15000) });
    const x = Number(((await r.json()) as { valor?: string }[])[0]?.valor) / 100;
    if (Number.isFinite(x) && x > 0.01 && x < 0.6) return x;
  } catch { /* usa a reserva */ }
  return 0.14;
}

const pct = (x: number | null | undefined) => (x === null || x === undefined || Number.isNaN(x) ? "-" : `${(x * 100).toFixed(1)}%`);
const rs = (x: number | null | undefined) => (x === null || x === undefined || Number.isNaN(x) ? "-" : `R$ ${x.toFixed(2)}`);

function imprimir(rel: Relatorio, info: { entradas: number; sinais: number; abertas: number; de: string; ate: string; cfg: ConfigBt }) {
  const lin = (nome: string, g: { n: number; taxaAcerto: number; media: number; soma: number; payoff: number | null; maxDrawdown: number }) =>
    `  ${nome.padEnd(22)} n=${String(g.n).padStart(4)}  acerto ${pct(g.taxaAcerto).padStart(6)}  média ${rs(g.media).padStart(10)}  soma ${rs(g.soma).padStart(12)}  payoff ${(g.payoff ?? NaN).toFixed(2).padStart(5)}  pior sequência ${rs(g.maxDrawdown)}`;
  console.log(`\n=== Backtest ${info.de} a ${info.ate} ===`);
  console.log(`Sinais gerados: ${info.sinais} | posições abertas: ${info.entradas} | ainda abertas no fim: ${info.abertas} | alvo ${info.cfg.alvoPct * 100}% do lucro máx., stop ${info.cfg.stopPct * 100}% da perda máx., custo R$ ${info.cfg.custoPorPerna}/perna`);
  console.log("\nSaídas gerenciadas:", Object.entries(rel.saidas).map(([k, v]) => `${k}=${v}`).join(" "));
  console.log("\nResultado gerenciado (método: sai no alvo, no stop ou no prazo)");
  console.log(lin("GERAL", rel.geral.gerenciado));
  for (const [e, r] of Object.entries(rel.porEstrategia)) console.log(lin(e, r.gerenciado));
  console.log("\nResultado mantido até o vencimento (o que a liquidação do Radar mede)");
  console.log(lin("GERAL", rel.geral.vencimento));
  for (const [e, r] of Object.entries(rel.porEstrategia)) console.log(lin(e, r.vencimento));
  console.log(`\nCalibração da probabilidade de lucro (vs. resultado no vencimento) | prevista média ${pct(rel.probMediaPrevista)}, realizada ${pct(rel.taxaAcertoVencimento)}, Brier ${rel.brier.toFixed(3)}`);
  for (const f of rel.calibracao) console.log(`  prevista ${f.faixa.padEnd(8)} n=${String(f.n).padStart(4)}  previsto ${pct(f.previsto).padStart(6)}  realizado ${pct(f.realizado).padStart(6)}${f.n < 30 ? "  (poucos casos)" : ""}`);
  console.log(`\nO score ordena os resultados? Spearman: gerenciado ${rel.spearmanScoreGerenciado?.toFixed(2) ?? "-"}, vencimento ${rel.spearmanScoreVencimento?.toFixed(2) ?? "-"} (perto de 0 = não; positivo = sim)`);
  console.log("\nLeitura: com poucos casos por faixa ou estratégia (n < 30), as médias não são confiáveis. Compare o gerenciado e o vencimento, e olhe o acerto junto com o payoff.");
}

async function main() {
  const arquivos = args.filter((a, i) => !a.startsWith("--") && !["--ativos", "--de", "--ate", "--passo", "--alvo", "--stop", "--custo", "--max-abertas", "--cdi", "--saida", "--baixar-anos", "--baixar-meses"].includes(args[i - 1] ?? ""));
  for (const ano of (valor("--baixar-anos") ?? "").split(",").filter(Boolean)) { const f = await baixar(`COTAHIST_A${ano}.ZIP`); if (f) arquivos.push(f); }
  const meses = Number(valor("--baixar-meses") ?? 0);
  if (meses > 0) {
    const d = new Date();
    for (let m = 0; m < meses; m++, d.setUTCMonth(d.getUTCMonth() - 1)) { const f = await baixar(`COTAHIST_M${String(d.getUTCMonth() + 1).padStart(2, "0")}${d.getUTCFullYear()}.ZIP`); if (f) arquivos.push(f); }
  }
  if (!arquivos.length) { console.error(`Informe arquivos do COTAHIST ou use --baixar-anos / --baixar-meses. Download manual: ${PAGINA_B3}`); process.exit(2); }

  const universo = Object.values(UNIVERSO_COTAHIST);
  const ativos = (valor("--ativos") ?? "PETR4,VALE3,BBAS3,ITUB4").split(",").map((a) => a.trim().toUpperCase()).filter((a) => universo.includes(a));
  if (!ativos.length) throw new Error(`Use ativos do universo: ${universo.join(", ")}`);
  const taxa = Math.log(1 + (await cdi()));
  console.log(`Ativos: ${ativos.join(", ")} | taxa livre de risco ${((Math.exp(taxa) - 1) * 100).toFixed(1)}% a.a.`);

  // 1) fechamento dos ativos em todos os dias; 2) opções (janela larga, para acompanhar as posições até o vencimento)
  const spots: Spots = new Map();
  for (const f of arquivos) { console.log(`Lendo fechamentos: ${f}`); for await (const l of lerLinhas(f)) { const r = parseLinha(l); if (r) acumularSpot(r, spots); } }
  if (!spots.size) throw new Error("nenhum fechamento do universo encontrado nos arquivos");
  const porDia = new Map<string, Map<string, LinhaCotahist[]>>();
  for (const f of arquivos) {
    console.log(`Lendo opções: ${f}`);
    for await (const l of lerLinhas(f)) {
      const r = parseLinha(l); const x = r && linhaOpcao(r, spots, taxa, JANELA_BT);
      if (!x || !ativos.includes(x.ativo)) continue;
      const d = porDia.get(x.data_coleta) ?? new Map<string, LinhaCotahist[]>();
      d.set(x.ativo, [...(d.get(x.ativo) ?? []), x]); porDia.set(x.data_coleta, d);
    }
  }
  const datas = [...spots.keys()].filter((d) => ativos.some((a) => spots.get(d)?.has(a))).sort();
  const dias: DiaBt[] = datas.map((data) => {
    const sp = spots.get(data)!, cot: DiaBt["cotacoes"] = {};
    for (const a of ativos) { const m: Record<string, { bid: number | null; ask: number | null; ultimo: number | null }> = {}; for (const o of porDia.get(data)?.get(a) ?? []) m[o.ticker] = { bid: o.bid, ask: o.ask, ultimo: o.ultimo }; cot[a] = m; }
    return { data, spots: Object.fromEntries(ativos.filter((a) => sp.has(a)).map((a) => [a, sp.get(a)!])), cotacoes: cot };
  });
  const de = valor("--de") ?? datas[0]!, ate = valor("--ate") ?? datas[datas.length - 1]!;
  console.log(`Dias de pregão: ${dias.length} (${datas[0]} a ${datas[datas.length - 1]}); simulando ${de} a ${ate}`);

  // histórico de IV por ativo, sem olhar o futuro (só dias já passados entram no IV Rank)
  const historicoIv = new Map<string, { data_coleta: string; iv: number | null; delta: number | null }[]>();
  const avancou = new Map<string, number>();
  const cfg: ConfigBt = {
    ...CONFIG_PADRAO, passo: Number(valor("--passo") ?? 1), alvoPct: Number(valor("--alvo") ?? CONFIG_PADRAO.alvoPct), stopPct: Number(valor("--stop") ?? CONFIG_PADRAO.stopPct),
    custoPorPerna: Number(valor("--custo") ?? 0), maxAbertasPorAtivo: Number(valor("--max-abertas") ?? CONFIG_PADRAO.maxAbertasPorAtivo),
  };
  const params = { ...PARAMS_PADRAO };
  console.log(`Estratégias do motor: ${params.estrategias_ativas.filter((k): k is EstrategiaKey => k in ESTRATEGIAS).join(", ")}`);
  const r = taxa;
  let amostraIv = 0;
  const gerar: Gerador = async (ativo, dia, i) => {
    if (dia.data < de || dia.data > ate) return [];
    const hist = historicoIv.get(ativo) ?? [];
    for (let k = avancou.get(ativo) ?? 0; k <= i; k++) for (const o of porDia.get(dias[k]!.data)?.get(ativo) ?? []) hist.push({ data_coleta: o.data_coleta, iv: o.iv, delta: o.delta });
    avancou.set(ativo, i + 1); historicoIv.set(ativo, hist);
    const corte = new Date(Date.parse(`${dia.data}T00:00:00Z`) - 365 * 86400000).toISOString().slice(0, 10);
    const ivr = ivRankSerie(hist.filter((h) => h.data_coleta >= corte));
    if (ivr !== null) amostraIv++;
    const linhas = (porDia.get(dia.data)?.get(ativo) ?? []).map((o) => ({ ticker: o.ticker, tipo: o.tipo, strike: o.strike, vencimento: o.vencimento, bid: o.bid, ask: o.ask, ultimo: o.ultimo, negocios: o.negocios, iv: o.iv, delta: o.delta, data_coleta: o.data_coleta }));
    if (!linhas.length) return [];
    const ctx: Ctx = { q: 0, valuation_score: null, sentimento: null, datas_com: [], datas_balanco: [], ivr };
    const sinais = await gerarSinais(ativo, dia.spots[ativo]!, linhas, ctx, params, new Date(`${dia.data}T00:00:00Z`), r);
    return sinais.map((s) => ({ chave: s.chave, estrategia: s.estrategia, vencimento: s.vencimento, score: s.score, prob_lucro: s.prob_lucro, lucro_max: s.lucro_max, perda_max: s.perda_max, credito_debito: s.credito_debito, _pernas: s._pernas.map((p) => ({ tipo: p.tipo, ticker: p.ticker, strike: p.strike, lado: p.lado, qtd: p.qtd, preco: p.preco })) }));
  };

  const sim = await simular(dias.filter((d) => d.data <= ate), ativos, gerar, cfg);
  if (!sim.trades.length) { console.log(`\nNenhuma operação fechada no período. Sinais gerados: ${sim.sinaisGerados}. Faltou histórico de IV (~12 meses antes de ${de}) ou o período é curto.`); return; }
  const rel = relatorio(sim.trades);
  imprimir(rel, { entradas: sim.entradas, sinais: sim.sinaisGerados, abertas: sim.abertas, de, ate, cfg });
  if (amostraIv === 0) console.warn("\nAVISO: o IV Rank ficou indisponível em todos os dias; faltou histórico anterior ao período. Os fatores de IV ficaram neutros.");
  const saida = valor("--saida") ?? "backtest-saida";
  mkdirSync(saida, { recursive: true });
  writeFileSync(join(saida, "backtest-resultados.json"), JSON.stringify({ periodo: { de, ate }, ativos, cfg, relatorio: rel, abertasNoFim: sim.abertas }, null, 2));
  writeFileSync(join(saida, "backtest-trades.csv"), paraCsv(sim.trades));
  console.log(`\nArquivos gravados em ${saida}/ (backtest-resultados.json e backtest-trades.csv)`);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
