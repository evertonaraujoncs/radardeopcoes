/**
 * Backtest do motor de sinais com dados históricos de opções (COTAHIST). Módulo puro: recebe os dias de mercado e uma função
 * que gera sinais; não conhece banco nem arquivos.
 *
 * Para cada sinal aberto, mede dois resultados:
 *  - gerenciado: sai no alvo (% do lucro máximo), no stop (% da perda máxima) ou na data de desmontar (como manda o método);
 *  - mantido até o vencimento: o que a liquidação do Radar mede hoje.
 * Entradas e saídas usam o lado desfavorável do book (compra no ask, venda no bid); sem book, o último negócio.
 */
export const LOTE = 100;

export interface PernaBt { tipo: "CALL" | "PUT" | "ACAO"; ticker: string; strike: number | null; lado: number; qtd: number; preco: number }
export interface SinalBt {
  chave: string; estrategia: string; vencimento: string; score: number; prob_lucro: number;
  lucro_max: number | null; perda_max: number; credito_debito: number; _pernas: PernaBt[];
}
export interface CotacaoBt { bid: number | null; ask: number | null; ultimo: number | null }
export interface DiaBt { data: string; spots: Record<string, number>; cotacoes: Record<string, Record<string, CotacaoBt>> }
export type Gerador = (ativo: string, dia: DiaBt, indice: number) => Promise<SinalBt[]>;

export interface ConfigBt {
  passo: number; // gera sinais a cada N dias de pregão
  alvoPct: number; // sai com este % do lucro máximo
  alvoIlimitado: number; // sem lucro máximo (compra seca): alvo = este múltiplo do prêmio pago
  stopPct: number; // sai com perda de este % da perda máxima
  custoPorPerna: number; // R$ por perna e por operação (corretagem + emolumentos)
  maxAbertasPorAtivo: number;
  desmontarDiasAntes: number; // dias corridos antes do vencimento para sair
}
export const CONFIG_PADRAO: ConfigBt = { passo: 1, alvoPct: 0.7, alvoIlimitado: 1, stopPct: 0.5, custoPorPerna: 0, maxAbertasPorAtivo: 3, desmontarDiasAntes: 2 };

export type MotivoSaida = "alvo" | "stop" | "tempo" | "vencimento";
export interface Trade {
  ativo: string; estrategia: string; chave: string; entrada: string; saida: string; motivoSaida: MotivoSaida; vencimento: string;
  score: number; prob: number; creditoDebito: number; lucroMax: number | null; perdaMax: number;
  resultado: number; // gerenciado, líquido de custos
  resultadoVencimento: number | null; // mantido até o vencimento, líquido de custos; null se o histórico acabou antes
  marcasVelhas: number; // dias em que alguma perna ficou sem cotação e foi usado o último preço conhecido
}

interface Posicao {
  ativo: string; sinal: SinalBt; entrada: string; desmontar: string; marcas: Record<string, number>; velhas: number;
  spotAteVenc: number | null; ger?: { data: string; motivo: MotivoSaida; resultado: number }; hold?: number;
}

const diasMenos = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);
const nOpcoes = (s: SinalBt) => s._pernas.filter((p) => p.tipo !== "ACAO").length;

function intrinseco(p: PernaBt, S: number): number {
  return p.tipo === "ACAO" ? S : p.tipo === "CALL" ? Math.max(S - (p.strike ?? 0), 0) : Math.max((p.strike ?? 0) - S, 0);
}
/** Resultado em R$ (lote de 100) no vencimento, sem custos. */
export function resultadoNoVencimentoBt(pernas: PernaBt[], S: number): number {
  return pernas.reduce((t, p) => t + p.lado * p.qtd * (intrinseco(p, S) - p.preco), 0) * LOTE;
}

function marcar(pos: Posicao, dia: DiaBt): number {
  let tot = 0, faltou = false;
  for (const p of pos.sinal._pernas) {
    let px: number | null = null;
    if (p.tipo === "ACAO") px = dia.spots[pos.ativo] ?? null;
    else {
      const c = dia.cotacoes[pos.ativo]?.[p.ticker];
      px = c ? (p.lado > 0 ? c.bid ?? c.ultimo : c.ask ?? c.ultimo) : null; // sair: vende o que comprou no bid, recompra o que vendeu no ask
    }
    if (px === null || !(px >= 0)) { faltou = true; px = pos.marcas[p.ticker] ?? p.preco; } else pos.marcas[p.ticker] = px;
    tot += p.lado * p.qtd * (px - p.preco);
  }
  if (faltou) pos.velhas++;
  return tot * LOTE;
}

export async function simular(dias: DiaBt[], ativos: string[], gerar: Gerador, cfg: ConfigBt = CONFIG_PADRAO): Promise<{ trades: Trade[]; abertas: number; sinaisGerados: number; entradas: number }> {
  const abertas: Posicao[] = [], trades: Trade[] = [], jaOperadas = new Set<string>();
  let sinaisGerados = 0, entradas = 0;
  const fechar = (p: Posicao, hold: number | null) => {
    const g = p.ger!, n = nOpcoes(p.sinal);
    trades.push({
      ativo: p.ativo, estrategia: p.sinal.estrategia, chave: p.sinal.chave, entrada: p.entrada, saida: g.data, motivoSaida: g.motivo, vencimento: p.sinal.vencimento,
      score: p.sinal.score, prob: p.sinal.prob_lucro, creditoDebito: p.sinal.credito_debito, lucroMax: p.sinal.lucro_max, perdaMax: p.sinal.perda_max,
      resultado: g.resultado - 2 * n * cfg.custoPorPerna, resultadoVencimento: hold === null ? null : hold - n * cfg.custoPorPerna, marcasVelhas: p.velhas,
    });
  };

  for (let i = 0; i < dias.length; i++) {
    const d = dias[i]!;
    for (const p of [...abertas]) {
      if (d.data <= p.entrada) continue;
      const venc = p.sinal.vencimento;
      if (d.data <= venc) p.spotAteVenc = d.spots[p.ativo] ?? p.spotAteVenc;
      if (!p.ger) {
        const mtm = marcar(p, d);
        const lucroRef = p.sinal.lucro_max ?? p.sinal.perda_max * cfg.alvoIlimitado;
        let motivo: MotivoSaida | null = null;
        if (d.data >= venc) motivo = "vencimento";
        else if (mtm <= -cfg.stopPct * p.sinal.perda_max) motivo = "stop";
        else if (mtm >= cfg.alvoPct * lucroRef) motivo = "alvo";
        else if (d.data >= p.desmontar) motivo = "tempo";
        if (motivo === "vencimento") {
          const S = p.spotAteVenc;
          const r = S === null ? mtm : resultadoNoVencimentoBt(p.sinal._pernas, S);
          p.ger = { data: d.data, motivo, resultado: r }; p.hold = r;
        } else if (motivo) p.ger = { data: d.data, motivo, resultado: mtm };
      } else if (p.hold === undefined && d.data >= venc && p.spotAteVenc !== null) {
        p.hold = resultadoNoVencimentoBt(p.sinal._pernas, p.spotAteVenc);
      }
      if (p.ger && p.hold !== undefined) { fechar(p, p.hold); abertas.splice(abertas.indexOf(p), 1); }
    }

    if (i % cfg.passo !== 0) continue;
    for (const ativo of ativos) {
      if (!d.spots[ativo]) continue;
      let ocupadas = abertas.filter((p) => p.ativo === ativo && !p.ger).length;
      if (ocupadas >= cfg.maxAbertasPorAtivo) continue;
      const sinais = await gerar(ativo, d, i);
      sinaisGerados += sinais.length;
      for (const s of sinais) {
        if (ocupadas >= cfg.maxAbertasPorAtivo) break;
        if (jaOperadas.has(s.chave) || s.vencimento <= d.data) continue;
        jaOperadas.add(s.chave); ocupadas++; entradas++;
        abertas.push({ ativo, sinal: s, entrada: d.data, desmontar: diasMenos(s.vencimento, cfg.desmontarDiasAntes), marcas: {}, velhas: 0, spotAteVenc: null });
      }
    }
  }
  // fim do histórico: quem já saiu pelo método entra sem o resultado de vencimento; quem ainda estava aberto fica de fora (censurado)
  let aindaAbertas = 0;
  for (const p of abertas) { if (p.ger) fechar(p, p.hold ?? null); else aindaAbertas++; }
  return { trades, abertas: aindaAbertas, sinaisGerados, entradas };
}

// ----------------------------------------------------------------------------- métricas
export interface Resumo { n: number; taxaAcerto: number; media: number; mediana: number; soma: number; payoff: number | null; maxDrawdown: number; retornoSobreRisco: number | null }

export function resumir(valores: number[], riscos: number[] = []): Resumo {
  const n = valores.length;
  if (!n) return { n: 0, taxaAcerto: 0, media: 0, mediana: 0, soma: 0, payoff: null, maxDrawdown: 0, retornoSobreRisco: null };
  const soma = valores.reduce((a, b) => a + b, 0), ord = [...valores].sort((a, b) => a - b);
  const ganhos = valores.filter((v) => v > 0), perdas = valores.filter((v) => v < 0);
  let pico = 0, acum = 0, dd = 0;
  for (const v of valores) { acum += v; pico = Math.max(pico, acum); dd = Math.max(dd, pico - acum); }
  const rr = valores.map((v, i) => (riscos[i] && riscos[i]! > 0 ? v / riscos[i]! : null)).filter((x): x is number => x !== null);
  return {
    n, taxaAcerto: ganhos.length / n, media: soma / n, mediana: n % 2 ? ord[(n - 1) / 2]! : (ord[n / 2 - 1]! + ord[n / 2]!) / 2, soma,
    payoff: ganhos.length && perdas.length ? (ganhos.reduce((a, b) => a + b, 0) / ganhos.length) / Math.abs(perdas.reduce((a, b) => a + b, 0) / perdas.length) : null,
    maxDrawdown: dd, retornoSobreRisco: rr.length ? rr.reduce((a, b) => a + b, 0) / rr.length : null,
  };
}

export interface FaixaCalibracao { faixa: string; n: number; previsto: number; realizado: number }
export function calibracao(prob: number[], acertou: boolean[], faixas = 10): FaixaCalibracao[] {
  const out: FaixaCalibracao[] = [];
  for (let f = 0; f < faixas; f++) {
    const lo = f / faixas, hi = (f + 1) / faixas;
    const idx = prob.map((p, i) => i).filter((i) => prob[i]! >= lo && (f === faixas - 1 ? prob[i]! <= hi : prob[i]! < hi));
    if (!idx.length) continue;
    out.push({ faixa: `${Math.round(lo * 100)}-${Math.round(hi * 100)}%`, n: idx.length, previsto: idx.reduce((a, i) => a + prob[i]!, 0) / idx.length, realizado: idx.filter((i) => acertou[i]).length / idx.length });
  }
  return out;
}
export const brier = (prob: number[], acertou: boolean[]) => (prob.length ? prob.reduce((a, p, i) => a + (p - (acertou[i] ? 1 : 0)) ** 2, 0) / prob.length : NaN);

function postos(v: number[]): number[] {
  const ord = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(v.length);
  for (let i = 0; i < ord.length;) { let j = i; while (j + 1 < ord.length && ord[j + 1]![0] === ord[i]![0]) j++; for (let k = i; k <= j; k++) r[ord[k]![1]] = (i + j) / 2 + 1; i = j + 1; }
  return r;
}
/** Correlação de postos (Spearman): o score ordena os resultados? Null com menos de 10 pontos ou sem variação. */
export function spearman(x: number[], y: number[]): number | null {
  if (x.length < 10 || x.length !== y.length) return null;
  const a = postos(x), b = postos(y), ma = a.reduce((s, v) => s + v, 0) / a.length, mb = b.reduce((s, v) => s + v, 0) / b.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { num += (a[i]! - ma) * (b[i]! - mb); da += (a[i]! - ma) ** 2; db += (b[i]! - mb) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : null;
}

export interface Relatorio {
  geral: { gerenciado: Resumo; vencimento: Resumo };
  porEstrategia: Record<string, { gerenciado: Resumo; vencimento: Resumo }>;
  saidas: Record<string, number>;
  calibracao: FaixaCalibracao[]; brier: number; probMediaPrevista: number; taxaAcertoVencimento: number;
  spearmanScoreGerenciado: number | null; spearmanScoreVencimento: number | null;
}

export function relatorio(trades: Trade[]): Relatorio {
  const comHold = trades.filter((t) => t.resultadoVencimento !== null);
  const res = (ts: Trade[]) => ({
    gerenciado: resumir(ts.map((t) => t.resultado), ts.map((t) => t.perdaMax)),
    vencimento: resumir(ts.filter((t) => t.resultadoVencimento !== null).map((t) => t.resultadoVencimento!), ts.filter((t) => t.resultadoVencimento !== null).map((t) => t.perdaMax)),
  });
  const porEstrategia: Relatorio["porEstrategia"] = {};
  for (const e of [...new Set(trades.map((t) => t.estrategia))].sort()) porEstrategia[e] = res(trades.filter((t) => t.estrategia === e));
  const saidas: Record<string, number> = {};
  for (const t of trades) saidas[t.motivoSaida] = (saidas[t.motivoSaida] ?? 0) + 1;
  const prob = comHold.map((t) => t.prob), ac = comHold.map((t) => t.resultadoVencimento! > 0);
  return {
    geral: res(trades), porEstrategia, saidas, calibracao: calibracao(prob, ac), brier: brier(prob, ac),
    probMediaPrevista: prob.length ? prob.reduce((a, b) => a + b, 0) / prob.length : NaN, taxaAcertoVencimento: ac.length ? ac.filter(Boolean).length / ac.length : NaN,
    spearmanScoreGerenciado: spearman(trades.map((t) => t.score), trades.map((t) => t.resultado)),
    spearmanScoreVencimento: spearman(comHold.map((t) => t.score), comHold.map((t) => t.resultadoVencimento!)),
  };
}

export function paraCsv(trades: Trade[]): string {
  const cab = ["ativo", "estrategia", "entrada", "saida", "motivo_saida", "vencimento", "score", "prob_lucro", "credito_debito", "lucro_max", "perda_max", "resultado", "resultado_vencimento", "marcas_velhas"];
  const f = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "number" ? String(Math.round(v * 100) / 100) : String(v));
  return [cab.join(","), ...trades.map((t) => [t.ativo, t.estrategia, t.entrada, t.saida, t.motivoSaida, t.vencimento, t.score, t.prob, t.creditoDebito, t.lucroMax, t.perdaMax, t.resultado, t.resultadoVencimento, t.marcasVelhas].map(f).join(","))].join("\n") + "\n";
}
