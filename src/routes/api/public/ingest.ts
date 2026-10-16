import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Endpoint de ingestão para o robô (motor_sinais.py).
 * O robô envia um POST com JSON contendo arrays por tabela.
 * Autenticação: header `x-ingest-key` deve bater com o segredo INGEST_KEY.
 */

const sinalSchema = z.object({
  chave: z.string().min(1).max(200),
  ticker: z.string().min(1).max(20),
  estrategia: z.string().min(1).max(60),
  vencimento: z.string().min(4).max(10),
  pernas: z.unknown(),
  status: z.string().max(20).optional(),
  score: z.number().nullable().optional(),
  prob_lucro: z.number().nullable().optional(),
  credito_debito: z.number().nullable().optional(),
  lucro_max: z.number().nullable().optional(),
  perda_max: z.number().nullable().optional(),
  retorno_sobre_risco: z.number().nullable().optional(),
  valor_esperado: z.number().nullable().optional(),
  preco_ativo: z.number().nullable().optional(),
  dias_vencimento: z.number().int().nullable().optional(),
  iv_rank: z.number().nullable().optional(),
  breakevens: z.unknown().optional(),
  curva_payoff: z.unknown().optional(),
  gregas: z.unknown().optional(),
  fatores: z.unknown().optional(),
  motivos: z.unknown().optional(),
  riscos: z.unknown().optional(),
  atualizado_em: z.string().optional(),
});

const payloadSchema = z.object({
  ativos: z.array(z.record(z.string(), z.unknown())).max(500).optional(),
  opcoes_grade: z.array(z.record(z.string(), z.unknown())).max(20000).optional(),
  sinais: z.array(sinalSchema).max(2000).optional(),
  sinais_historico: z.array(z.record(z.string(), z.unknown())).max(5000).optional(),
  alertas: z.array(z.record(z.string(), z.unknown())).max(500).optional(),
  noticias: z.array(z.record(z.string(), z.unknown())).max(1000).optional(),
  fundamentos: z.array(z.record(z.string(), z.unknown())).max(500).optional(),
  eventos: z.array(z.record(z.string(), z.unknown())).max(500).optional(),
  dividendos: z.array(z.record(z.string(), z.unknown())).max(1000).optional(),
  scraper_status: z.array(z.record(z.string(), z.unknown())).max(50).optional(),
});

function keyValida(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = createHmac("sha256", "ingest").update(provided).digest();
  const b = createHmac("sha256", "ingest").update(expected).digest();
  return timingSafeEqual(a, b);
}

export const Route = createFileRoute("/api/public/ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env["INGEST_KEY"];
        if (!expected) {
          return Response.json({ erro: "INGEST_KEY não configurada no servidor" }, { status: 500 });
        }
        if (!keyValida(request.headers.get("x-ingest-key"), expected)) {
          return Response.json({ erro: "chave inválida" }, { status: 401 });
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ erro: "JSON inválido" }, { status: 400 });
        }
        const parsed = payloadSchema.safeParse(body);
        if (!parsed.success) {
          return Response.json({ erro: "payload inválido", detalhes: parsed.error.issues.slice(0, 5) }, { status: 400 });
        }
        const p = parsed.data;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const resultado: Record<string, number | string> = {};

        // Sinais: upsert pela chave única (atualiza sinal existente ou cria novo)
        const sinais = p["sinais"];
        if (sinais?.length) {
          const { error } = await supabaseAdmin
            .from("sinais")
            .upsert(sinais, { onConflict: "chave" });
          if (error) return Response.json({ erro: `sinais: ${error.message}` }, { status: 500 });
          resultado["sinais"] = sinais.length;
        }

        // Demais tabelas: inserção simples
        const simples = [
          ["ativos", p["ativos"]],
          ["opcoes_grade", p["opcoes_grade"]],
          ["sinais_historico", p["sinais_historico"]],
          ["alertas", p["alertas"]],
          ["noticias", p["noticias"]],
          ["fundamentos", p["fundamentos"]],
          ["eventos", p["eventos"]],
          ["dividendos", p["dividendos"]],
          ["scraper_status", p["scraper_status"]],
        ] as const;

        for (const [tabela, linhas] of simples) {
          if (!linhas?.length) continue;
          const { error } = await supabaseAdmin.from(tabela).insert(linhas as never);
          if (error) return Response.json({ erro: `${tabela}: ${error.message}` }, { status: 500 });
          resultado[tabela as string] = linhas.length;
        }

        return Response.json({ ok: true, gravados: resultado });
      },
    },
  },
});
