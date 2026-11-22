/**
 * Alinhamento de datas entre as opções e o ativo.
 * Antes: cada opção entrava com a sua cotação mais recente dentro de 4 dias, e o ativo com o preço do momento da coleta.
 * Uma perna podia ser de segunda e outra de quinta, com o ativo em outro preço: IV, delta e probabilidade saíam distorcidos.
 * Agora: só entram opções negociadas no pregão de referência (o mais recente) e o ativo vale o fechamento desse mesmo pregão.
 */
import { diaSP } from "./settlement";

export const MAX_PREGOES_DEFASAGEM = 3; // acima disso a grade é considerada velha demais para gerar sinais

export interface Alinhado<T> {
  dataRef: string; // AAAA-MM-DD do pregão de referência
  linhas: T[]; // só as cotações desse pregão
  descartadas: number; // cotações de dias anteriores deixadas de fora
  spot: number | null;
  fonteSpot: "fechamento" | "preco_atual" | null;
  pregoesDefasagem: number; // pregões entre o de referência e hoje
  avisos: string[];
}

const dia = (s: string) => s.slice(0, 10);
const utc = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** Dias úteis (seg-sex) entre a data `de` (exclusive) e `ate` (inclusive). */
export function pregoesEntre(de: string, ate: string): number {
  let n = 0;
  for (let t = utc(de) + 86400000; t <= utc(ate); t += 86400000) { const w = new Date(t).getUTCDay(); if (w !== 0 && w !== 6) n++; }
  return n;
}

/** Fechamento do ativo no dia indicado, a partir de ativos.historico_precos (último candle daquele dia, em Brasília). */
export function fechamentoDoDia(historico: unknown, alvo: string): number | null {
  if (!Array.isArray(historico)) return null;
  let melhor: { t: number; v: number } | null = null;
  for (const c of historico) {
    const r = c as { momento?: unknown; fechamento?: unknown } | null;
    if (!r || typeof r.momento !== "string" || Number.isNaN(Date.parse(r.momento))) continue;
    const v = Number(r.fechamento);
    if (!Number.isFinite(v) || v <= 0 || diaSP(r.momento) !== alvo) continue;
    const t = Date.parse(r.momento);
    if (!melhor || t > melhor.t) melhor = { t, v };
  }
  return melhor ? melhor.v : null;
}

export function alinharCotacoes<T extends { data_coleta: string }>(linhas: T[], historico: unknown, precoAtual: number | null, hojeStr: string): Alinhado<T> {
  const avisos: string[] = [];
  const validas = linhas.filter((l) => typeof l.data_coleta === "string" && dia(l.data_coleta) <= hojeStr);
  if (!validas.length) return { dataRef: hojeStr, linhas: [], descartadas: 0, spot: null, fonteSpot: null, pregoesDefasagem: 0, avisos: ["sem cotações de opções recentes"] };
  const dataRef = validas.reduce((m, l) => (dia(l.data_coleta) > m ? dia(l.data_coleta) : m), dia(validas[0]!.data_coleta));
  const mesmoDia = validas.filter((l) => dia(l.data_coleta) === dataRef);
  const pregoesDefasagem = pregoesEntre(dataRef, hojeStr);

  let spot = fechamentoDoDia(historico, dataRef);
  let fonteSpot: Alinhado<T>["fonteSpot"] = spot !== null ? "fechamento" : null;
  if (spot === null && dataRef === hojeStr && precoAtual && precoAtual > 0) { spot = precoAtual; fonteSpot = "preco_atual"; }
  if (spot === null) avisos.push(`sem o fechamento do ativo em ${dataRef} para precificar as opções do mesmo pregão`);

  if (pregoesDefasagem > MAX_PREGOES_DEFASAGEM) {
    return { dataRef, linhas: [], descartadas: validas.length, spot, fonteSpot, pregoesDefasagem, avisos: [`grade de opções do pregão de ${dataRef}, com ${pregoesDefasagem} pregões de defasagem (máximo ${MAX_PREGOES_DEFASAGEM}); colete novamente`, ...avisos] };
  }
  return { dataRef, linhas: mesmoDia, descartadas: validas.length - mesmoDia.length, spot, fonteSpot, pregoesDefasagem, avisos };
}
