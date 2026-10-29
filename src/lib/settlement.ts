import { ALERTA_SCORE } from "./signal-engine";
import { fmtBRL, nomeEstrategia } from "./format";
import { normalizarPernas, payoffNoVencimento } from "./payoff";

const FUSO = "America/Sao_Paulo";
const TOLERANCIA_DIAS = 5; // feriado no vencimento: aceita o último pregão até 5 dias antes
const PRAZO_SEM_PRECO_DIAS = 15; // depois disso, encerra sem resultado em vez de ficar aberto para sempre

export const diaSP = (v: string | Date) => new Date(v).toLocaleDateString("en-CA", { timeZone: FUSO });
const diasEntre = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000;

/** Fechamento do ativo no vencimento (ou no último pregão antes dele). Null se o histórico ainda não cobre a data. */
export function precoNoVencimento(historico: unknown, vencimento: string): { preco: number; data: string } | null {
  if (!Array.isArray(historico)) return null;
  const candles = historico.flatMap((c) => {
    const r = c as { momento?: unknown; fechamento?: unknown } | null;
    const preco = Number(r?.fechamento);
    if (!r || typeof r.momento !== "string" || !Number.isFinite(preco) || preco <= 0 || Number.isNaN(Date.parse(r.momento))) return [];
    return [{ data: diaSP(r.momento), preco }];
  }).sort((a, b) => a.data.localeCompare(b.data));
  if (!candles.length || candles[candles.length - 1]!.data < vencimento) return null;
  const ate = candles.filter((c) => c.data <= vencimento);
  const ultimo = ate[ate.length - 1];
  return ultimo && diasEntre(ultimo.data, vencimento) <= TOLERANCIA_DIAS ? ultimo : null;
}

/** Resultado em R$ (lote de 100) da estrutura se mantida até o vencimento. Null se as pernas forem inválidas. */
export function resultadoNoVencimento(pernas: unknown, precoFinal: number): number | null {
  const normalizadas = normalizarPernas(pernas);
  if (!normalizadas.length || !Number.isFinite(precoFinal)) return null;
  return Math.round(payoffNoVencimento(normalizadas, precoFinal) * 100) / 100;
}

type Vencido = { id: number; ticker: string; estrategia: string; score: number | null; vencimento: string; pernas: unknown };

/**
 * Encerra sinais cujo vencimento já passou, gravando o resultado real (fechamento no vencimento).
 * Idempotente: só atualiza linhas ainda "ativo", então rodar de novo não duplica nem sobrescreve.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function liquidarVencidos(db: any, opcoes: { ticker?: string; agora?: Date } = {}) {
  const agora = opcoes.agora ?? new Date();
  const hoje = diaSP(agora);
  let consulta = db.from("sinais").select("id,ticker,estrategia,score,vencimento,pernas").eq("status", "ativo").lt("vencimento", hoje).limit(500);
  if (opcoes.ticker) consulta = consulta.eq("ticker", opcoes.ticker);
  const { data, error } = await consulta;
  if (error) throw new Error(error.message);
  const vencidos = (data ?? []) as Vencido[];
  if (!vencidos.length) return { liquidados: 0, pendentes: 0 };

  const tickers = [...new Set(vencidos.map((s) => s.ticker))];
  const precos = await db.from("ativos").select("ticker,historico_precos").in("ticker", tickers);
  if (precos.error) throw new Error(precos.error.message);
  const historicos = new Map<string, unknown>((precos.data ?? []).map((a: { ticker: string; historico_precos: unknown }) => [a.ticker, a.historico_precos]));

  let liquidados = 0, pendentes = 0;
  const alertas: { sinal_id: number; tipo: string; mensagem: string }[] = [];
  for (const s of vencidos) {
    const p = precoNoVencimento(historicos.get(s.ticker), s.vencimento);
    if (!p && diasEntre(s.vencimento, hoje) < PRAZO_SEM_PRECO_DIAS) { pendentes++; continue; }
    const resultado = p ? resultadoNoVencimento(s.pernas, p.preco) : null;
    const up = await db.from("sinais").update({
      status: "encerrado", motivo_encerramento: "vencimento", encerrado_em: agora.toISOString(), atualizado_em: agora.toISOString(),
      preco_vencimento: p?.preco ?? null, resultado,
    }).eq("id", s.id).eq("status", "ativo").select("id");
    if (up.error) throw new Error(up.error.message);
    if (!up.data?.length) continue; // outro processo já liquidou este sinal
    liquidados++;
    if (resultado !== null && (s.score ?? 0) >= ALERTA_SCORE) {
      const [, m, d] = s.vencimento.split("-");
      alertas.push({ sinal_id: s.id, tipo: "encerrado", mensagem: `Vencimento: ${nomeEstrategia(s.estrategia)} em ${s.ticker} (${d}/${m}) terminou com ${resultado >= 0 ? "lucro" : "prejuízo"} de ${fmtBRL(Math.abs(resultado))} (fechamento ${fmtBRL(p!.preco)}).` });
    }
  }
  if (alertas.length) {
    const a = await db.from("alertas").insert(alertas);
    if (a.error) throw new Error(a.error.message);
  }
  return { liquidados, pendentes };
}
