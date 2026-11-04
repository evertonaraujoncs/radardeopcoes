import { deduplicarPorChave } from "./dedupe";
import { ehVencimentoMensal } from "./metodo";
import { oplabGet, parseAcao, parseHistorico, parseOpcoes } from "./oplab";
import { diaSP } from "./settlement";

const msg = (e: unknown) => (e instanceof Error ? e.message : "falha");
const diasAte = (hoje: string, d: string) => (Date.parse(`${d}T00:00:00Z`) - Date.parse(`${hoje}T00:00:00Z`)) / 86400000;

export interface ResultadoOplab { precos: boolean; opcoes: boolean; historyCount: number; optionsCount: number; cotacoes: number; warnings: string[] }

/**
 * Coleta preço, histórico, IV Rank/Percentil e grade de opções (com bid/ask) pela OpLab para um ativo.
 * Lança erro só se a cotação do ativo falhar; problemas parciais viram avisos, e a coleta antiga assume o que faltar.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function coletarOplab(db: any, ticker: string, opts: { optionsOnly: boolean }): Promise<ResultadoOplab> {
  const r: ResultadoOplab = { precos: false, opcoes: false, historyCount: 0, optionsCount: 0, cotacoes: 0, warnings: [] };
  const agora = new Date(), now = agora.toISOString(), hoje = diaSP(agora);

  const acao = parseAcao(await oplabGet(`/market/stocks/${ticker}`));
  if (!acao) throw new Error("cotação do ativo ausente na resposta da OpLab");

  let historico: ReturnType<typeof parseHistorico> = [];
  if (!opts.optionsOnly) {
    try {
      const de = new Date(agora.getTime() - 370 * 86400000).toISOString().slice(0, 10).replace(/-/g, "");
      historico = parseHistorico(await oplabGet(`/market/historical/${ticker}/1d?from=${de}0000`));
      if (historico.length < 60) r.warnings.push(`Histórico OpLab com ${historico.length} pregões (mínimo 60); usando outra fonte para o histórico.`);
    } catch (e) { r.warnings.push(`Histórico OpLab: ${msg(e)}`); }
  }
  const usarHistorico = historico.length >= 60;
  const linhaAtivo: Record<string, unknown> = {
    ticker, nome: acao.nome ?? ticker, preco: acao.preco, atualizado_em: acao.time ?? now, fonte_preco: "OpLab",
    iv_atual: acao.ivAtual, iv_rank_1y: acao.ivRank1y, iv_percentil_1y: acao.ivPercentil1y, iv_atualizado_em: acao.ivRank1y !== null ? now : null,
  };
  if (usarHistorico) linhaAtivo["historico_precos"] = historico;
  const up = await db.from("ativos").upsert(linhaAtivo, { onConflict: "ticker" });
  if (up.error) throw new Error(up.error.message);
  r.precos = opts.optionsOnly || usarHistorico;
  r.historyCount = usarHistorico ? historico.length : 0;
  if (acao.ivRank1y === null) r.warnings.push("OpLab não informou IV Rank/Percentil para este ativo; o motor usa o histórico de IV ou a volatilidade histórica.");

  try {
    const { linhas, camposNaoReconhecidos } = parseOpcoes(await oplabGet(`/market/options/${ticker}`), ticker, hoje);
    if (!linhas.length) throw new Error(`nenhuma opção reconhecida na resposta (campos recebidos: ${camposNaoReconhecidos.join(", ") || "nenhum"})`);
    const vencs = [...new Set(linhas.map((l) => l.vencimento))].filter((d) => ehVencimentoMensal(d) && diasAte(hoje, d) >= 15 && diasAte(hoje, d) <= 60).sort().slice(0, 3);
    if (!vencs.length) throw new Error("nenhum vencimento mensal entre 15 e 60 dias na resposta");
    const unicas = deduplicarPorChave(linhas.filter((l) => vencs.includes(l.vencimento)), ["ticker", "data_coleta"]);
    for (let i = 0; i < unicas.length; i += 500) {
      const { error } = await db.from("opcoes_grade").upsert(unicas.slice(i, i + 500), { onConflict: "ticker,data_coleta" });
      if (error) throw new Error(error.message);
    }
    r.opcoes = true; r.cotacoes = unicas.length; r.optionsCount = unicas.length;
    const semLivro = unicas.filter((l) => l.bid === null || l.ask === null).length;
    if (semLivro) r.warnings.push(`OpLab: ${semLivro} de ${unicas.length} opções sem bid/ask de duas pontas; nelas o motor usa o último negócio com margem.`);
  } catch (e) { r.warnings.push(`Opções OpLab: ${msg(e)}; usando opcoes.net.br.`); }
  return r;
}
