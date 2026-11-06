/** OpLab v3 market contract. Numeric volatility fields are percentages (0..100). */
export const OPLAB_BASE = "https://api.oplab.com.br/v3";
const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const number = (v: unknown): number | null => v == null || v === "" || typeof v === "boolean" ? null : Number.isFinite(Number(v)) ? Number(v) : null;
const positive = (v: unknown) => { const n = number(v); return n !== null && n > 0 ? n : null; };
export function normalizarChaves(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalizarChaves);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k.replace(/-/g, "_"), normalizarChaves(x)]));
  return v;
}
export function quoteTime(value: unknown): string | null {
  const n = typeof value === "number" ? value : null;
  const date = n !== null ? new Date(n > 1e11 ? n : n * 1000) : typeof value === "string" ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) && date.getUTCFullYear() >= 2000 ? date.toISOString() : null;
}
const percent = (v: unknown) => { const n = number(v); return n !== null && n >= 0 && n <= 100 ? n / 100 : null; };
export function parseAcao(payload: unknown, ticker: string) {
  const o = obj(normalizarChaves(payload)), preco = positive(o["close"]), time = quoteTime(o["time"]);
  if (o["symbol"] !== ticker || preco === null || !time) throw new Error("Cotação OpLab sem ativo ou data confirmados.");
  const iv = positive(o["iv_current"]);
  return { ticker, nome: typeof o["name"] === "string" ? o["name"] : ticker, preco, time,
    ivAtual: iv === null ? null : iv / 100,
    ivRank1y: iv === null ? null : percent(o["iv_"]1y_rank),
    ivPercentil1y: iv === null ? null : percent(o["iv_"]1y_percentile) };
}
export function parseHistorico(payload: unknown, ticker: string) {
  const o = obj(payload);
  if (o["symbol"] !== ticker || !Array.isArray(o["data"])) throw new Error("Histórico OpLab sem ativo confirmado.");
  return o["data"].flatMap(item => {
    const c = obj(item), momento = quoteTime(c["time"]), fechamento = positive(c["close"]);
    return momento && fechamento !== null ? [{ momento, fechamento, abertura: number(c["open"]), maxima: number(c["high"]), minima: number(c["low"]), volume: number(c["volume"]) }] : [];
  }).sort((a, b) => a.momento.localeCompare(b.momento));
}
export function parseOpcoes(payload: unknown, ticker: string, stockTime: string) {
  if (!Array.isArray(payload) || payload.length < 5) throw new Error("Grade OpLab incompleta.");
  const rows = payload.flatMap(item => {
    const o = obj(normalizarChaves(item));
    const symbol = typeof o["symbol"] === "string" ? o["symbol"] : "";
    const tipo = typeof o["category"] === "string" ? o["category"].toUpperCase() : "";
    const strike = positive(o["strike"]), time = quoteTime(o["time"]);
    const vencimento = typeof o["due_date"] === "string" ? o["due_date"].slice(0, 10) : "";
    // The endpoint identifies the underlying; also reject an explicit conflicting parent and dates.
    if (!/^[A-Z0-9]{4}[A-X]\d{1,4}(W\d|E)?$/.test(symbol) || symbol.slice(0, 4) !== ticker.slice(0, 4) || (o["parent_symbol"] != null && o["parent_symbol"] !== ticker) || !["CALL", "PUT"].includes(tipo) || strike === null || !time || time.slice(0, 10) > stockTime.slice(0, 10) || !/^\d{4}-\d{2}-\d{2}$/.test(vencimento) || !Number.isFinite(Date.parse(vencimento))) return [];
    const bid = positive(o["bid"]), ask = positive(o["ask"]), book = bid !== null && ask !== null && ask >= bid;
    return [{ ticker: symbol, ativo: ticker, ativo_base: ticker, tipo, strike, vencimento,
      data_coleta: new Date(time).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }),
      ultimo: positive(o["close"]), bid: book ? bid : null, ask: book ? ask : null,
      negocios: number(o["trades"]), volume: number(o["volume"]), iv: positive(o["iv"]) === null ? null : Number(o["iv"]) / 100,
      delta: number(o["delta"]), gamma: number(o["gamma"]), theta: number(o["theta"]), vega: number(o["vega"]), fonte: OPLAB_BASE }];
  });
  if (rows.length < 5 || rows.length < payload.length * 0.9) throw new Error("Grade OpLab reprovada: ativo, datas ou campos não confirmados.");
  return [...new Map(rows.map(row => [row.ticker, row])).values()];
}