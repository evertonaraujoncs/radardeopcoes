import type { Perna } from "./format";
import { normalizarPernas } from "./payoff";

export type CotacaoCarteira = {
  ticker: string;
  tipo: string | null;
  strike: number | null;
  vencimento: string | null;
  bid: number | null;
  ask: number | null;
  ultimo: number | null;
  data_coleta: string;
};

export type PernaMarcada = Perna & { preco_atual: number };

const numeroValido = (value: unknown) => Number.isFinite(Number(value));

/** Base do retorno: débito pago ou, em estruturas a crédito, perda máxima por lote. */
export function capitalBaseEntrada(creditoDebito: number, perdaMax: number | null): number | null {
  const debito = creditoDebito < 0 ? Math.abs(creditoDebito) : 0;
  const base = debito > 0 ? debito : perdaMax != null && numeroValido(perdaMax) ? Math.abs(Number(perdaMax)) : 0;
  return base > 0 ? base : null;
}

export function retornoCarteira(resultado: number, capitalBase: number | null): number | null {
  return capitalBase != null && capitalBase > 0 ? resultado / capitalBase : null;
}

/** Preço para desfazer a perna: comprada vende no bid; vendida recompra no ask. */
export function precoSaida(perna: Perna, cotacao: CotacaoCarteira | undefined, vencimento: string): { preco: number; estimado: boolean } | null {
  if (!cotacao || cotacao.ticker !== perna.ticker || cotacao.tipo?.toUpperCase() !== perna.tipo || cotacao.vencimento !== vencimento) return null;
  if (perna.strike == null || cotacao.strike == null || Math.abs(Number(cotacao.strike) - perna.strike) > 0.000001) return null;
  const oferta = Number(perna.lado > 0 ? cotacao.bid : cotacao.ask);
  if (Number.isFinite(oferta) && oferta > 0) return { preco: oferta, estimado: false };
  const ultimo = Number(cotacao.ultimo);
  return Number.isFinite(ultimo) && ultimo >= 0 ? { preco: ultimo, estimado: true } : null;
}

function calcularMarcacao(pernas: Perna[], precoAtual: (perna: Perna) => { preco: number; estimado: boolean } | null) {
  const marcadas: PernaMarcada[] = [];
  let resultado = 0;
  let premioAtual = 0;
  let precoEstimado = false;
  for (const perna of pernas) {
    const atual = precoAtual(perna);
    if (!atual) return null;
    resultado += perna.lado * perna.qtd * (atual.preco - perna.preco) * 100;
    premioAtual -= perna.lado * perna.qtd * atual.preco * 100;
    precoEstimado ||= atual.estimado;
    marcadas.push({ ...perna, preco_atual: atual.preco });
  }
  return { resultado, premioAtual, pernasAtuais: marcadas, precoEstimado };
}

/** Marcação a mercado por lote; qualquer perna sem preço válido impede inventar um resultado. */
export function marcarCarteira(
  value: unknown,
  cotacoes: Record<string, CotacaoCarteira | undefined>,
  precoAtivo: number | null,
  vencimento: string,
) {
  const pernas = normalizarPernas(value);
  if (!pernas.length) return null;
  return calcularMarcacao(pernas, (perna) => {
    if (perna.tipo === "ACAO") {
      return precoAtivo != null && Number.isFinite(precoAtivo) && precoAtivo > 0 ? { preco: precoAtivo, estimado: false } : null;
    }
    return precoSaida(perna, cotacoes[perna.ticker], vencimento);
  });
}

/** Resultado final por lote com o fechamento real do ativo no vencimento. */
export function marcarCarteiraNoVencimento(value: unknown, precoFinal: number) {
  const pernas = normalizarPernas(value);
  if (!pernas.length || !Number.isFinite(precoFinal) || precoFinal <= 0) return null;
  return calcularMarcacao(pernas, (perna) => ({
    preco: perna.tipo === "ACAO" ? precoFinal : perna.tipo === "CALL"
      ? Math.max(0, precoFinal - (perna.strike ?? 0))
      : Math.max(0, (perna.strike ?? 0) - precoFinal),
    estimado: false,
  }));
}
