import type { Json, Tables } from "@/integrations/supabase/types";
import { marcarCarteira, marcarCarteiraNoVencimento, retornoCarteira, type CotacaoCarteira } from "./carteira";
import { diaSP, precoNoVencimento } from "./settlement";

type Posicao = Tables<"carteira">;
type SinalAtual = { chave: string; score: number | null; prob_lucro: number | null };

// Atualização privilegiada e server-owned: usuários nunca enviam preços ou resultados.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function atualizarCarteira(db: any, ticker: string, agora = new Date()) {
  const positions = await db.from("carteira").select("*").eq("ticker", ticker).limit(1000);
  if (positions.error) throw new Error(positions.error.message);
  const carteira = (positions.data ?? []) as Posicao[];
  if (!carteira.length) return { atualizadas: 0, parciais: 0 };

  const hoje = diaSP(agora);
  const desde = diaSP(new Date(agora.getTime() - 4 * 86400000));
  const [asset, signals, chain] = await Promise.all([
    db.from("ativos").select("preco,historico_precos").eq("ticker", ticker).maybeSingle(),
    db.from("sinais").select("chave,score,prob_lucro").eq("ticker", ticker).eq("status", "ativo"),
    db.from("opcoes_grade").select("ticker,tipo,strike,vencimento,bid,ask,ultimo,data_coleta")
      .eq("ativo_base", ticker).gte("data_coleta", desde).order("data_coleta", { ascending: false }).limit(10000),
  ]);
  for (const result of [asset, signals, chain]) if (result.error) throw new Error(result.error.message);
  const precoAtivoRaw = Number(asset.data?.preco);
  const precoAtivo = Number.isFinite(precoAtivoRaw) && precoAtivoRaw > 0 ? precoAtivoRaw : null;
  const ativos = new Map<string, SinalAtual>((signals.data ?? []).map((s: SinalAtual) => [s.chave, s]));
  const cotacoes: Record<string, CotacaoCarteira | undefined> = {};
  for (const row of (chain.data ?? []) as CotacaoCarteira[]) {
    if (!cotacoes[row.ticker]) cotacoes[row.ticker] = row;
  }

  let atualizadas = 0;
  let parciais = 0;
  for (const posicao of carteira) {
    const sinal = ativos.get(posicao.chave);
    const base = {
      sinal_ativo: !!sinal && posicao.vencimento >= hoje,
      score_atual: sinal?.score ?? null,
      prob_lucro_atual: sinal?.prob_lucro ?? null,
    };
    let update: Record<string, unknown> = base;
    if (posicao.vencimento < hoje) {
      const fechamento = precoNoVencimento(asset.data?.historico_precos, posicao.vencimento);
      const marcacao = fechamento ? marcarCarteiraNoVencimento(posicao.pernas, fechamento.preco) : null;
      if (fechamento && marcacao) {
        update = {
          ...base,
          sinal_ativo: false,
          preco_ativo_atual: fechamento.preco,
          pernas_atuais: marcacao.pernasAtuais as unknown as Json,
          premio_atual: marcacao.premioAtual,
          resultado: marcacao.resultado,
          retorno_pct: retornoCarteira(marcacao.resultado, posicao.capital_base),
          preco_estimado: posicao.preco_estimado || marcacao.precoEstimado,
          cobertura: "vencimento",
          atualizado_em: agora.toISOString(),
        };
        atualizadas++;
      } else {
        update = { ...base, sinal_ativo: false, cobertura: "sem_preco" };
        parciais++;
      }
    } else {
      const marcacao = marcarCarteira(posicao.pernas, cotacoes, precoAtivo, posicao.vencimento);
      if (marcacao) {
        update = {
          ...base,
          preco_ativo_atual: precoAtivo,
          pernas_atuais: marcacao.pernasAtuais as unknown as Json,
          premio_atual: marcacao.premioAtual,
          resultado: marcacao.resultado,
          retorno_pct: retornoCarteira(marcacao.resultado, posicao.capital_base),
          preco_estimado: posicao.preco_estimado || marcacao.precoEstimado,
          cobertura: "completa",
          atualizado_em: agora.toISOString(),
        };
        atualizadas++;
      } else {
        update = { ...base, cobertura: "parcial" };
        parciais++;
      }
    }
    const saved = await db.from("carteira").update(update).eq("id", posicao.id);
    if (saved.error) throw new Error(saved.error.message);
  }
  return { atualizadas, parciais };
}
