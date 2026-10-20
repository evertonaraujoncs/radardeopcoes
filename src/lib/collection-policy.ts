// Portable protections adapted from the uploaded opcoes_scraper_1.py.
export const COLLECTION_POLICY = { pauseSeconds: 30, attempts: 4, minimumHours: 4, backoffBase: 60, backoffCap: 900, failedAssets: 2 } as const;
export function pauseMilliseconds(random = Math.random()) {
  return COLLECTION_POLICY.pauseSeconds * (0.7 + 0.6 * random) * 1000;
}
export function retryMilliseconds(attempt: number, retryAfter: number, random = Math.random()) {
  const wait = Math.max(retryAfter, COLLECTION_POLICY.backoffBase * 2 ** attempt) * (0.8 + 0.5 * random);
  return Math.min(Math.max(wait, retryAfter), Math.max(COLLECTION_POLICY.backoffCap, retryAfter)) * 1000;
}
export function retryAfterSeconds(value: string | null, now = Date.now()) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, (date - now) / 1000) : 0;
}
export function providerBlocked(status: number, body: string) {
  return [403, 429, 503].includes(status) || /limite de requisi|muitas requisi|too many requests|rate limit|acesso temporariamente/i.test(body);
}
export type CollectionSchedule = { kind: "ready" | "wait" | "recent"; token?: string; until?: string; circuit?: boolean };
export function readSchedule(data: unknown): CollectionSchedule {
  if (!data || typeof data !== "object" || !("kind" in data) || !["ready", "wait", "recent"].includes(String(data.kind))) throw new Error("Não foi possível consultar o intervalo da coleta.");
  const row = data as Record<string, unknown>;
  if (row["kind"] === "ready" && typeof row["token"] !== "string") throw new Error("Não foi possível reservar a coleta.");
  return { kind: row["kind"] as CollectionSchedule["kind"], token: typeof row["token"] === "string" ? row["token"] : undefined, until: typeof row["until"] === "string" ? row["until"] : undefined, circuit: row["circuit"] === true };
}