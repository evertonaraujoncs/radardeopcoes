import { OPLAB_BASE, normalizarChaves, parseAcao, parseHistorico, parseOpcoes } from "./oplab";
import { retryAfterSeconds } from "./collection-policy";

export class OplabError extends Error {
  constructor(message: string, public status = 0, public retryAfter = 0) { super(message); }
}
export async function oplabGet(path: string, token: string): Promise<unknown> {
  const response = await fetch(`${OPLAB_BASE}${path}`, { headers: { "Access-Token": token, Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new OplabError(response.status === 401 || response.status === 403 ? "Acesso OpLab recusado; confira ou atualize o segredo OPLAB_ACCESS_TOKEN." : `OpLab respondeu HTTP ${response.status}.`, response.status, retryAfterSeconds(response.headers.get("Retry-After")));
  return normalizarChaves(await response.json());
}

// Partial failures are independent: a valid stock/IV snapshot survives a chain failure.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function coletarOplab(db: any, ticker: string, token: string, optionsOnly: boolean, get = oplabGet) {
  const result = { precos: false, opcoes: false, historyCount: 0, optionsCount: 0, warnings: [] as string[], blocked: false, retrySeconds: 0 };
  const fail = (label: string, error: unknown) => {
    if (error instanceof OplabError && [429, 503].includes(error.status)) { result.blocked = true; result.retrySeconds = Math.max(result.retrySeconds, error.retryAfter); }
    result.warnings.push(`${label}: ${error instanceof OplabError ? error.message : "dados indisponíveis ou inválidos"}; usando a fonte alternativa.`);
  };
  let stock: ReturnType<typeof parseAcao>;
  try { stock = parseAcao(await get(`/market/stocks/${ticker}`, token), ticker); }
  catch (error) { fail("OpLab", error); return result; }
  const saved = await db.from("ativos").upsert({ ticker, nome: stock.nome, preco: stock.preco, atualizado_em: stock.time, fonte_preco: `${OPLAB_BASE}/market/stocks/${ticker}`,
    iv_atual: stock.ivAtual, iv_rank_1y: stock.ivRank1y, iv_percentil_1y: stock.ivPercentil1y, iv_atualizado_em: stock.ivRank1y === null ? null : stock.time }, { onConflict: "ticker" });
  if (saved.error) throw new Error("Não foi possível salvar a cotação OpLab.");
  if (stock.ivRank1y === null) result.warnings.push("OpLab não informou IV Rank de um ano; o motor usará o histórico disponível.");
  if (!optionsOnly) {
    try {
      const from = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10).replace(/-/g, "");
      const history = parseHistorico(await get(`/market/historical/${ticker}/1d?from=${from}0000`, token), ticker);
      if (history.length < 60) throw new Error("Histórico insuficiente");
      const up = await db.from("ativos").update({ historico_precos: history }).eq("ticker", ticker);
      if (up.error) throw new Error("Falha ao salvar histórico");
      result.precos = true; result.historyCount = history.length;
    } catch (error) { fail("Histórico OpLab", error); }
  }
  try {
    const all = parseOpcoes(await get(`/market/options/${ticker}`, token), ticker, stock.time);
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const expiries = [...new Set(all.map(row => row.vencimento))].filter(date => { const days = (Date.parse(date) - Date.parse(today)) / 86400000; return days >= 15 && days <= 60; }).sort().slice(0, 3);
    const rows = all.filter(row => expiries.includes(row.vencimento) && Date.parse(today) - Date.parse(row.data_coleta) <= 4 * 86400000);
    if (!rows.length) throw new Error("Sem grade recente");
    for (let i = 0; i < rows.length; i += 500) {
      const up = await db.from("opcoes_grade").upsert(rows.slice(i, i + 500), { onConflict: "ticker,data_coleta" });
      if (up.error) throw new Error("Não foi possível salvar a grade OpLab.");
    }
    result.opcoes = true; result.optionsCount = rows.length;
    if (rows.some(row => row.bid === null || row.ask === null)) result.warnings.push("OpLab: ofertas ausentes em parte da grade; os preços dessas opções continuam estimados pelo último negócio.");
    if (rows.some(row => row.iv === null || row.delta === null)) result.warnings.push("OpLab: IV/gregas por opção não fornecidas nesta resposta; estimativas do motor não são gregas do provedor.");
  } catch (error) { fail("Opções OpLab", error); }
  return result;
}