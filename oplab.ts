/**
 * Cliente e parsers da API da OpLab (https://api.oplab.com.br/v3).
 * O token NUNCA fica no código: vem do segredo OPLAB_ACCESS_TOKEN do servidor (cabeçalho `Access-Token`).
 * Os parsers são tolerantes: a OpLab usa chaves com hífen ou sublinhado conforme a versão, e a lista de opções pode vir
 * como array ou agrupada por série. Se algo não for reconhecido, a coleta avisa com os nomes dos campos recebidos.
 */
import { diaSP } from "./settlement";

export const OPLAB_BASE = "https://api.oplab.com.br/v3";
export const oplabConfigurado = () => !!process.env["OPLAB_ACCESS_TOKEN"];

export class OplabError extends Error {
  constructor(msg: string, public status?: number, public retryAfter?: number) { super(msg); this.name = "OplabError"; }
}

/** "iv-1y-rank" -> "iv_1y_rank", recursivamente. */
export function normalizarChaves(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalizarChaves);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k.replace(/-/g, "_"), normalizarChaves(x)]));
  return v;
}

let tokenRenovado: string | null = null;

/** Opcional: o token da OpLab vence em ~2 semanas. Com OPLAB_EMAIL e OPLAB_PASSWORD o servidor renova sozinho; sem eles, atualize o segredo. */
async function renovarToken(base: string): Promise<string | null> {
  const email = process.env["OPLAB_EMAIL"], password = process.env["OPLAB_PASSWORD"];
  if (!email || !password) return null;
  const r = await fetch(`${base}/domain/users/authenticate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(20000) });
  if (!r.ok) return null;
  const j = normalizarChaves(await r.json()) as Record<string, unknown>;
  return typeof j["access_token"] === "string" ? (j["access_token"] as string) : null;
}

export async function oplabGet(path: string): Promise<unknown> {
  const base = (process.env["OPLAB_API_URL"] ?? OPLAB_BASE).replace(/\/$/, "");
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const token = tokenRenovado ?? process.env["OPLAB_ACCESS_TOKEN"];
    if (!token) throw new OplabError("OPLAB_ACCESS_TOKEN não configurado no servidor.");
    const r = await fetch(`${base}${path}`, { headers: { "Access-Token": token, Accept: "application/json" }, signal: AbortSignal.timeout(30000) });
    if (r.status === 401 || r.status === 403) {
      const novo = tentativa === 0 ? await renovarToken(base) : null;
      if (novo) { tokenRenovado = novo; continue; }
      throw new OplabError("Token da OpLab inválido ou expirado (vale ~2 semanas): gere um novo e atualize o segredo OPLAB_ACCESS_TOKEN.", r.status);
    }
    if (r.status === 429) throw new OplabError("Limite de requisições da OpLab atingido; tente novamente mais tarde.", 429, Number(r.headers.get("Retry-After")) || undefined);
    if (!r.ok) throw new OplabError(`OpLab respondeu HTTP ${r.status}.`, r.status);
    return normalizarChaves(await r.json());
  }
  throw new OplabError("Falha ao autenticar na OpLab.");
}

const nz = (x: unknown): number | null => (x === null || x === undefined || x === "" || typeof x === "boolean" ? null : Number.isFinite(Number(x)) ? Number(x) : null);
const pos = (x: unknown): number | null => { const v = nz(x); return v !== null && v > 0 ? v : null; };
const txt = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x.trim() : null);
const obj = (x: unknown): Record<string, unknown> => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {});
const clamp01 = (x: number | null) => (x === null ? null : Math.max(0, Math.min(1, x)));

// --------------------------------------------------------------------------- ação
export interface AcaoOplab { symbol: string | null; nome: string | null; preco: number; ivAtual: number | null; ivRank1y: number | null; ivPercentil1y: number | null; time: string | null }

/** IV Rank/Percentil de 1 ano já calculados pela OpLab (a API os entrega em %, 0 a 100; frações também são aceitas). */
export function parseAcao(payload: unknown): AcaoOplab | null {
  const o = obj(payload);
  const preco = pos(o["close"]) ?? pos(o["price"]);
  if (preco === null) return null;
  const ivAtual = nz(o["iv_current"] ?? o["iv"]), rank = nz(o["iv_1y_rank"]), pct = nz(o["iv_1y_percentile"]), max = nz(o["iv_1y_max"]);
  const disponivel = ivAtual !== null && ivAtual > 0; // a OpLab devolve zeros quando não há dado
  const emPercentual = [ivAtual, rank, pct, max].some((v) => v !== null && v > 3);
  const esc = (v: number | null) => (v === null ? null : emPercentual ? v / 100 : v);
  const t = nz(o["time"]);
  return {
    symbol: txt(o["symbol"]), nome: txt(o["name"]), preco,
    ivAtual: disponivel ? esc(ivAtual) : null,
    ivRank1y: disponivel ? clamp01(esc(rank)) : null,
    ivPercentil1y: disponivel ? clamp01(esc(pct)) : null,
    time: t !== null ? new Date(t > 1e11 ? t : t * 1000).toISOString() : null,
  };
}

// --------------------------------------------------------------------------- histórico
export function parseHistorico(payload: unknown) {
  const lista = Array.isArray(payload) ? payload : Array.isArray(obj(payload)["data"]) ? (obj(payload)["data"] as unknown[]) : [];
  return lista.flatMap((c) => {
    const r = obj(c);
    const t = nz(r["time"]), fechamento = pos(r["close"]);
    if (t === null || fechamento === null) return [];
    return [{ momento: new Date(t > 1e11 ? t : t * 1000).toISOString(), abertura: nz(r["open"]), maxima: nz(r["high"]), minima: nz(r["low"]), fechamento, volume: nz(r["volume"]) }];
  }).sort((a, b) => a.momento.localeCompare(b.momento));
}

// --------------------------------------------------------------------------- opções
const REGEX_OPCAO = /^[A-Z0-9]{4}[A-X]\d{1,4}(W\d|E)?$/;
const tipoDe = (o: Record<string, unknown>): "CALL" | "PUT" | null => {
  for (const k of ["category", "option_type", "instrument_type", "type"]) {
    const v = txt(o[k])?.toUpperCase();
    if (v === "CALL" || v === "PUT") return v;
  }
  return null;
};
const dataDe = (o: Record<string, unknown>): string | null => {
  for (const k of ["due_date", "expiration_date", "expiry", "maturity_date"]) {
    const v = txt(o[k])?.slice(0, 10);
    if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  }
  return null;
};

export type LinhaOpcaoOplab = {
  ticker: string; ativo: string; ativo_base: string; tipo: "CALL" | "PUT"; strike: number; vencimento: string; data_coleta: string;
  ultimo: number | null; bid: number | null; ask: number | null; negocios: number | null; volume: number | null;
  iv: number | null; delta: number | null; gamma: number | null; theta: number | null; vega: number | null; fonte: string;
};

/** Percorre a resposta (array, `data`, ou agrupada por série) e devolve as opções reconhecidas + os campos do primeiro item não reconhecido. */
export function parseOpcoes(payload: unknown, ativo: string, hoje = diaSP(new Date())): { linhas: LinhaOpcaoOplab[]; camposNaoReconhecidos: string[] } {
  const achados: { o: Record<string, unknown>; sym: string; tipo: "CALL" | "PUT" | null; venc: string | null }[] = [];
  let amostra: string[] = [];
  const visitar = (no: unknown, ctx: { tipo: "CALL" | "PUT" | null; venc: string | null }, chave?: string, prof = 0) => {
    if (prof > 6 || no === null || typeof no !== "object") return;
    if (Array.isArray(no)) { no.forEach((el) => visitar(el, ctx, undefined, prof + 1)); return; }
    const o = no as Record<string, unknown>;
    const tipo = tipoDe(o) ?? ctx.tipo, venc = dataDe(o) ?? ctx.venc;
    const sym = txt(o["symbol"]) ?? (chave && REGEX_OPCAO.test(chave) ? chave : null);
    if (nz(o["strike"]) !== null && sym) { achados.push({ o, sym, tipo, venc }); return; }
    if (!amostra.length && prof <= 2) amostra = Object.keys(o).slice(0, 25);
    for (const [k, v] of Object.entries(o)) visitar(v, { tipo, venc }, k, prof + 1);
  };
  visitar(payload, { tipo: null, venc: null });
  const base = ativo.slice(0, 4);
  const linhas: LinhaOpcaoOplab[] = [];
  for (const { o, sym, tipo, venc } of achados) {
    const strike = pos(o["strike"]);
    if (!strike || !tipo || !venc || !REGEX_OPCAO.test(sym) || sym.slice(0, 4) !== base) continue;
    const bid = pos(o["bid"]), ask = pos(o["ask"]);
    const livro = bid !== null && ask !== null && ask >= bid;
    const volume = nz(o["volume"]);
    const trades = nz(o["trades"] ?? o["number_of_trades"] ?? o["negocios"]);
    linhas.push({
      ticker: sym, ativo, ativo_base: ativo, tipo, strike, vencimento: venc, data_coleta: hoje,
      ultimo: pos(o["close"] ?? o["last"]), bid: livro ? bid : null, ask: livro ? ask : null,
      // Sem contagem de negócios na resposta, usa lotes de 100 negociados como aproximação de liquidez.
      negocios: trades !== null ? trades : volume !== null ? Math.round(volume / 100) : null, volume,
      iv: pos(o["iv"] ?? o["implied_volatility"] ?? o["volatility"]), delta: nz(o["delta"]), gamma: nz(o["gamma"]), theta: nz(o["theta"]), vega: nz(o["vega"]),
      fonte: OPLAB_BASE,
    });
  }
  return { linhas, camposNaoReconhecidos: linhas.length ? [] : amostra };
}
