export function parseOptions(rows: unknown[], ticker: string, expiry: string, collectedAt: string) {
  return rows.flatMap((row) => {
    if (!Array.isArray(row) || typeof row[0] !== "string" || !["CALL", "PUT"].includes(row[2]) || typeof row[5] !== "number") return [];
    const tradeDate = typeof row[11] === "string" ? row[11] : "";
    const date = /^\d{4}-\d{2}-\d{2}$/.test(tradeDate) ? `${tradeDate}T00:00:00-03:00` : tradeDate;
    // Never present retrieval time as the original option quote time.
    if (!date || !Number.isFinite(Date.parse(date))) return [];
    return [{ ticker: row[0].split("_")[0], ativo: ticker, ativo_base: ticker, tipo: row[2] as string,
      strike: row[5] as number, ultimo: typeof row[8] === "number" ? row[8] : null,
      negocios: typeof row[9] === "number" ? row[9] : null,
      volume: typeof row[10] === "number" ? row[10] : null,
      vencimento: expiry, data_coleta: new Date(date).toISOString(), bid: null, ask: null, iv: null, delta: null }];
  });
}