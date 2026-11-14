import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { asArr } from "./format";
import { normalizarPernas } from "./payoff";
import { capitalBaseEntrada } from "./carteira";

export const entrarNaCarteira = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ sinalId: z.number().int().positive() }).parse(input))
  .handler(async ({ data, context }) => {
    const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const { data: sinal, error } = await context.supabase.from("sinais").select("*")
      .eq("id", data.sinalId).eq("status", "ativo").gte("vencimento", hoje).maybeSingle();
    if (error) throw new Error("Não foi possível consultar o sinal.");
    if (!sinal) throw new Error("Este sinal não está mais ativo no Radar.");
    if (sinal.chave.startsWith("TESTE-")) throw new Error("Sinais de teste não podem entrar na carteira.");

    const pernas = normalizarPernas(sinal.pernas);
    const precoAtivo = Number(sinal.preco_ativo);
    const creditoDebito = Number(sinal.credito_debito);
    if (!pernas.length || !Number.isFinite(precoAtivo) || precoAtivo <= 0 || !Number.isFinite(creditoDebito)) {
      throw new Error("O sinal não tem dados suficientes para registrar a entrada.");
    }
    const perdaMax = sinal.perda_max == null ? null : Number(sinal.perda_max);
    const capitalBase = capitalBaseEntrada(creditoDebito, perdaMax);
    const agora = new Date().toISOString();
    const pernasAtuais = pernas.map((perna) => ({ ...perna, preco_atual: perna.preco }));
    const row = {
      user_id: context.userId,
      sinal_id: sinal.id,
      chave: sinal.chave,
      ticker: sinal.ticker,
      estrategia: sinal.estrategia,
      pernas: pernas as unknown as Json,
      vencimento: sinal.vencimento,
      entrada_em: agora,
      preco_ativo_entrada: precoAtivo,
      credito_debito_entrada: creditoDebito,
      perda_max_entrada: perdaMax,
      capital_base: capitalBase,
      score_entrada: sinal.score,
      prob_lucro_entrada: sinal.prob_lucro,
      retorno_risco_entrada: sinal.retorno_sobre_risco,
      preco_ativo_atual: precoAtivo,
      pernas_atuais: pernasAtuais as unknown as Json,
      premio_atual: creditoDebito,
      resultado: 0,
      retorno_pct: capitalBase == null ? null : 0,
      score_atual: sinal.score,
      prob_lucro_atual: sinal.prob_lucro,
      sinal_ativo: true,
      preco_estimado: asArr<string>(sinal.riscos).includes("preco_sem_bid_ask"),
      cobertura: "entrada",
      atualizado_em: agora,
    };
    const inserted = await context.supabase.from("carteira").upsert(row, { onConflict: "user_id,chave", ignoreDuplicates: true }).select("id");
    if (inserted.error) throw new Error("Não foi possível salvar a operação na carteira.");
    if (inserted.data[0]) return { id: inserted.data[0].id, existente: false };
    const existing = await context.supabase.from("carteira").select("id").eq("user_id", context.userId).eq("chave", sinal.chave).single();
    if (existing.error) throw new Error("A operação já existe, mas não foi possível abri-la.");
    return { id: existing.data.id, existente: true };
  });
