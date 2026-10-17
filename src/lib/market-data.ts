export function parseOptionTickers(xml: string) {
  return [...new Set([...xml.matchAll(/\/opcoes\/bovespa\/([A-Z]{4}\d{1,2})(?:<|\/|\?|$)/g)].flatMap(match => match[1] ? [match[1]] : []))].sort();
}

export function selectedTargets(available: string[], selection: string) {
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
    if (!Array.isArray(row) || typeof row[0] !== "string" || !["CALL", "PUT"].includes(row[2]) || typeof row[5] !== "number") return [];
    const tradeDate = typeof row[11] === "string" ? row[11] : "";
    const date = /^\d{4}-\d{2}-\d{2}$/.test(tradeDate) ? `${tradeDate}T00:00:00-03:00` : tradeDate;
    // Never present retrieval time as the original option quote time.
    if (!date || !Number.isFinite(Date.parse(date))) return [];
    const code = row[0].split("_")[0];
    if (!code) return [];
    return [{ ticker: code, ativo: ticker, ativo_base: ticker, tipo: row[2] as string,
      strike: row[5] as number, ultimo: typeof row[8] === "number" ? row[8] : null,
      negocios: typeof row[9] === "number" ? row[9] : null,
      volume: typeof row[10] === "number" ? row[10] : null,
      vencimento: expiry, data_coleta: new Date(date).toISOString(), bid: null, ask: null, iv: null, delta: null }];
  });
}