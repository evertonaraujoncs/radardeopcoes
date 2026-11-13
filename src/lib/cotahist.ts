/**
 * Leitura do COTAHIST da B3 (Cotações Históricas, gratuito) e conversão em linhas de `opcoes_grade`.
 * Layout oficial: registro tipo 01, largura fixa de 245 caracteres, posições abaixo em base 1.
 * Entrega, para cada opção do universo: último, melhor oferta de compra/venda no fechamento (bid/ask), negócios, volume,
 * strike e vencimento. IV e delta são calculados aqui (Black-Scholes) a partir do preço e do fechamento do ativo no mesmo dia,
 * o que permite reconstruir o histórico de IV de um ano de uma vez.
 * Módulo puro e independente do motor de sinais.
 */

/** Raiz do código da opção (4 letras) -> ticker do ativo-objeto. */
export const UNIVERSO_COTAHIST: Record<string, string> = {
  PETR: "PETR4", VALE: "VALE3", BBAS: "BBAS3", ITUB: "ITUB4", BBDC: "BBDC4", SANB: "SANB11", BOVA: "BOVA11",
};
const ATIVOS = new Set(Object.values(UNIVERSO_COTAHIST));

export interface RegistroCotahist {
  data: string; codbdi: string; codneg: string; tpmerc: string;
  preult: number; preofc: number; preofv: number; totneg: number; quatot: number;
  preexe: number; datven: string;
}

const campo = (l: string, ini: number, fim: number) => l.slice(ini - 1, fim);
const dinheiro = (s: string) => Number(s) / 100; // 11(V99)
const iso = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

/** Interpreta uma linha do arquivo. Só os registros tipo 01 (cotações) interessam; header (00) e trailer (99) devolvem null. */
export function parseLinha(l: string): RegistroCotahist | null {
  if (l.length < 210 || l.slice(0, 2) !== "01") return null;
  const preult = dinheiro(campo(l, 109, 121));
  const preexe = dinheiro(campo(l, 189, 201));
  const datven = campo(l, 203, 210);
  if (!Number.isFinite(preult) || !Number.isFinite(preexe) || !/^\d{8}$/.test(campo(l, 3, 10))) return null;
  return {
    data: iso(campo(l, 3, 10)), codbdi: campo(l, 11, 12).trim(), codneg: campo(l, 13, 24).trim(), tpmerc: campo(l, 25, 27),
    preult, preofc: dinheiro(campo(l, 122, 134)), preofv: dinheiro(campo(l, 135, 147)),
    totneg: Number(campo(l, 148, 152)), quatot: Number(campo(l, 153, 170)),
    preexe, datven: /^\d{8}$/.test(datven) ? iso(datven) : "",
  };
}

// ----------------------------------------------------------------------------- fechamento do ativo no dia
export type Spots = Map<string, Map<string, number>>; // data -> ticker -> fechamento

export function acumularSpot(r: RegistroCotahist, spots: Spots) {
  if (r.tpmerc !== "010" || !(r.codbdi === "02" || r.codbdi === "14") || !ATIVOS.has(r.codneg) || r.preult <= 0) return;
  const dia = spots.get(r.data) ?? new Map<string, number>();
  dia.set(r.codneg, r.preult);
  spots.set(r.data, dia);
}

// ----------------------------------------------------------------------------- Black-Scholes (independente do motor)
const normPdf = (x: number) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
function normCdf(x: number): number {
  // Numerical Recipes erfcc, erro < 1,2e-7
  const z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.5 * z);
  const erfc = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? 1 - 0.5 * erfc : 0.5 * erfc;
}
export function bsPreco(S: number, K: number, T: number, r: number, sig: number, tipo: "CALL" | "PUT"): number {
  const v = sig * Math.sqrt(T), d1 = (Math.log(S / K) + (r + 0.5 * sig * sig) * T) / v, d2 = d1 - v;
  return tipo === "CALL" ? S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2) : K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1);
}
export function ivImplicita(preco: number, S: number, K: number, T: number, r: number, tipo: "CALL" | "PUT"): number | null {
  let lo = 1e-3, hi = 6;
  if (preco < bsPreco(S, K, T, r, lo, tipo) - 1e-9 || preco > bsPreco(S, K, T, r, hi, tipo) + 1e-9) return null;
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (bsPreco(S, K, T, r, m, tipo) > preco) hi = m; else lo = m; }
  return (lo + hi) / 2;
}
export function bsDelta(S: number, K: number, T: number, r: number, sig: number, tipo: "CALL" | "PUT"): number {
  const d1 = (Math.log(S / K) + (r + 0.5 * sig * sig) * T) / (sig * Math.sqrt(T));
  void normPdf;
  return tipo === "CALL" ? normCdf(d1) : normCdf(d1) - 1;
}

// ----------------------------------------------------------------------------- datas
const dia = (s: string) => Date.parse(`${s}T00:00:00Z`);
export const diasCorridos = (a: string, b: string) => Math.round((dia(b) - dia(a)) / 86400000);
/** Dias úteis (seg-sex) entre a data (exclusive) e o vencimento (inclusive); mesma convenção do motor. */
export function diasUteis(a: string, b: string): number {
  let n = 0;
  for (let t = dia(a) + 86400000; t <= dia(b); t += 86400000) { const w = new Date(t).getUTCDay(); if (w !== 0 && w !== 6) n++; }
  return n;
}
/** Vencimento mensal = terceira sexta-feira (ou a quinta, se a sexta for feriado). */
export function vencimentoMensal(d: string): boolean {
  const x = new Date(`${d}T00:00:00Z`), n = x.getUTCDate(), w = x.getUTCDay();
  return (w === 5 && n >= 15 && n <= 21) || (w === 4 && n >= 14 && n <= 20);
}

// ----------------------------------------------------------------------------- linha de opcoes_grade
export interface LinhaGrade {
  ticker: string; ativo: string; ativo_base: string; tipo: "CALL" | "PUT"; strike: number; vencimento: string; data_coleta: string;
  ultimo: number | null; bid: number | null; ask: number | null; negocios: number; volume: number;
  iv: number | null; delta: number | null; fonte: string;
}

export const JANELA = { diasMin: 15, diasMax: 60, faixaStrike: 0.15, premioMin: 0.05 } as const;

/** taxa = taxa livre de risco contínua (ln(1 + CDI)). Devolve null para o que o Radar não usa (outro ativo, fora da janela, sem fechamento do ativo no dia). */
export function linhaOpcao(r: RegistroCotahist, spots: Spots, taxa: number): LinhaGrade | null {
  if (r.tpmerc !== "070" && r.tpmerc !== "080") return null;
  const ativo = UNIVERSO_COTAHIST[r.codneg.slice(0, 4)];
  if (!ativo || !r.datven || r.preexe <= 0) return null;
  const S = spots.get(r.data)?.get(ativo);
  if (!S) return null;
  const dc = diasCorridos(r.data, r.datven);
  if (dc < JANELA.diasMin || dc > JANELA.diasMax || !vencimentoMensal(r.datven) || Math.abs(r.preexe / S - 1) > JANELA.faixaStrike) return null;
  const tipo = r.tpmerc === "070" ? "CALL" : "PUT";
  const livro = r.preofc > 0 && r.preofv > 0 && r.preofv >= r.preofc;
  const ultimo = r.preult > 0 ? r.preult : null;
  const refPreco = livro ? (r.preofc + r.preofv) / 2 : r.totneg > 0 ? ultimo : null;
  const T = diasUteis(r.data, r.datven) / 252;
  const iv = refPreco !== null && refPreco >= JANELA.premioMin && T > 0 ? ivImplicita(refPreco, S, r.preexe, T, taxa, tipo) : null;
  return {
    ticker: r.codneg, ativo, ativo_base: ativo, tipo, strike: r.preexe, vencimento: r.datven, data_coleta: r.data,
    ultimo, bid: livro ? r.preofc : null, ask: livro ? r.preofv : null, negocios: r.totneg, volume: r.quatot,
    iv: iv !== null ? Math.round(iv * 1e6) / 1e6 : null,
    delta: iv !== null ? Math.round(bsDelta(S, r.preexe, T, taxa, iv, tipo) * 1e6) / 1e6 : null,
    fonte: "B3 COTAHIST",
  };
}

/** Conveniência (testes e arquivos pequenos): lê todas as linhas de uma vez. Para arquivos grandes o script faz duas passagens. */
export function construirLinhas(linhas: Iterable<string>, taxa: number): LinhaGrade[] {
  const regs: RegistroCotahist[] = [];
  const spots: Spots = new Map();
  for (const l of linhas) { const r = parseLinha(l); if (r) { regs.push(r); acumularSpot(r, spots); } }
  return regs.flatMap((r) => { const x = linhaOpcao(r, spots, taxa); return x ? [x] : []; });
}
