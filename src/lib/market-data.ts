export function parseOptionTickers(xml: string) {
  return [...new Set([...xml.matchAll(/\/opcoes\/bovespa\/([A-Z]{4}\d{1,2})(?:<|\/|\?|$)/g)].flatMap(match => match[1] ? [match[1]] : []))].sort();
}

export function rankLiquidTargets(payload: unknown, available: string[]) {
  const stocks = (payload as { stocks?: unknown[] } | null)?.stocks;
  if (!Array.isArray(stocks)) throw new Error("Ranking de liquidez indisponível na fonte.");
  const allowed = new Set(available);
  const ranked = new Map<string, number>();
  for (const item of stocks) {
    const row = item as { stock?: string; close?: number; volume?: number } | null;
    if (!row || !row.stock || !allowed.has(row.stock) || typeof row.close !== "number" || typeof row.volume !== "number" || !Number.isFinite(row.close) || !Number.isFinite(row.volume) || row.close <= 0 || row.volume <= 0) continue;
    ranked.set(row.stock, row.close * row.volume);
  }
  const tickers = [...ranked].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 20).map(([ticker]) => ticker);
  if (tickers.length < 20) throw new Error("A fonte não forneceu volume válido para 20 ativos com opções. Tente novamente ou selecione um ticker.");
  return tickers;
}

export function selectedTargets(available: string[], selection: string, liquid: string[] = []) {
  if (selection === "top20") return [...new Set(liquid)].filter(ticker => available.includes(ticker)).slice(0, 20);
  return selection === "all" ? [...available] : available.filter(ticker => ticker === selection);
}

export function parseYahooNews(payload: unknown, ticker: string) {
  const news = (payload as { news?: unknown[] } | null)?.news;
  if (!Array.isArray(news)) return [];
  return news.flatMap(item => {
    const row = item as { title?: string; link?: string; publisher?: string; providerPublishTime?: number; relatedTickers?: string[] } | null;
    if (!row || typeof row.title !== "string" || typeof row.link !== "string" || !row.link.startsWith("https://") || !row.relatedTickers?.includes(`${ticker}.SA`) || !Number.isFinite(row.providerPublishTime)) return [];
    return [{ ticker, titulo: row.title, url: row.link, fonte: `Yahoo Finance · ${row.publisher ?? "Yahoo"}`, publicado_em: new Date(Number(row.providerPublishTime) * 1000).toISOString(), sentimento: null }];
  });
}

export function parseYahooEvents(calendar: unknown, ticker: string) {
  const data = calendar as { earnings?: { earningsDate?: { raw?: number }[] }; exDividendDate?: { raw?: number }; dividendDate?: { raw?: number } } | null;
  const entries = [
    ...(data?.earnings?.earningsDate ?? []).map(date => ({ date: date.raw, tipo: "resultados", descricao: "Data estimada de resultados · Yahoo Finance" })),
    { date: data?.exDividendDate?.raw, tipo: "data_ex_dividendo", descricao: "Data ex-dividendo · Yahoo Finance" },
    { date: data?.dividendDate?.raw, tipo: "pagamento_dividendo", descricao: "Pagamento de dividendos · Yahoo Finance" },
  ];
  return entries.flatMap(entry => typeof entry.date === "number" && Number.isFinite(entry.date) && entry.date > 0 ? [{ ticker, tipo: entry.tipo, descricao: entry.descricao, data: new Date(entry.date * 1000).toISOString().slice(0, 10) }] : []);
}

export function parseOptions(rows: unknown[], ticker: string, expiry: string, _collectedAt: string) {
  return rows.flatMap((row) => {
    if (!Array.isArray(row) || typeof row[0] !== "string" || !["CALL", "PUT"].includes(row[2]) || typeof row[5] !== "number" || !Number.isFinite(row[5]) || row[5] <= 0) return [];
    const tradeDate = typeof row[11] === "string" ? row[11] : "";
    const date = /^\d{4}-\d{2}-\d{2}$/.test(tradeDate) ? `${tradeDate}T00:00:00-03:00` : tradeDate;
    // Never present retrieval time as the original option quote time.
    if (!date || !Number.isFinite(Date.parse(date))) return [];
    const code = row[0].split("_")[0];
    if (!code || !/^[A-Z0-9]{4}[A-X]\d{1,4}(W\d|E)?$/.test(code) || code.slice(0, 4) !== ticker.slice(0, 4)) return [];
    return [{ ticker: code, ativo: ticker, ativo_base: ticker, tipo: row[2] as string,
      strike: row[5] as number, ultimo: typeof row[8] === "number" ? row[8] : null,
      negocios: typeof row[9] === "number" ? row[9] : null,
      volume: typeof row[10] === "number" ? row[10] : null,
      vencimento: expiry, data_coleta: new Date(date).toISOString(), bid: null, ask: null, iv: null, delta: null }];
  });
}

// Reject broken/misattributed grids before any shared write or signal calculation.
export function validateOptionGrid(rows: unknown[], ticker: string, expiry: string, collectedAt: string) {
  const parsed = parseOptions(rows, ticker, expiry, collectedAt);
  const structural = rows.filter(row => {
    if (!Array.isArray(row) || typeof row[0] !== "string" || !["CALL", "PUT"].includes(row[2]) || typeof row[5] !== "number" || !Number.isFinite(row[5]) || row[5] <= 0) return false;
    const code = row[0].split("_")[0];
    return !!code && /^[A-Z0-9]{4}[A-X]\d{1,4}(W\d|E)?$/.test(code) && code.slice(0, 4) === ticker.slice(0, 4);
  });
  if (rows.length < 5 || structural.length < rows.length * 0.9) throw new Error("Grade reprovada: poucas linhas válidas, campos alterados ou ativo não confirmado.");
  return [...new Map(parsed.map(row => [row.ticker, row])).values()];
}