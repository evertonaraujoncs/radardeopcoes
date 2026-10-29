import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { deduplicarPorChave } from "@/lib/dedupe";
import { diaSP, liquidarVencidos } from "@/lib/settlement";

/**
 * Endpoint de ingestão para o robô (motor_sinais.py).
 * O robô envia um POST com JSON contendo arrays por tabela.
 * Autenticação: header `x-ingest-key` deve bater com o segredo INGEST_KEY.
 *
 * Idempotente: reenviar o mesmo lote (retry do robô, timeout, duplo clique) não duplica linhas.
 *  - Tabelas com chave natural usam upsert (sinais, ativos, opcoes_grade, fundamentos, dividendos, eventos, noticias).
 *  - Tabelas de eventos sem chave natural (sinais_historico, alertas, scraper_status) ficam protegidas pelo
 *    lote: header `Idempotency-Key` (permanente) ou, sem ele, o hash do corpo (janela de 15 min).
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

const JANELA_HASH_MIN = 15;

/** Chaves naturais de cada tabela (colunas do índice/constraint único). */
const CHAVE_NATURAL = {
  ativos: "ticker",
  opcoes_grade: "ticker,data_coleta",
  fundamentos: "ticker,data",
  dividendos: "ticker,data_com,tipo",
  eventos: "ticker,tipo,data",
  noticias: "url",
} as const;
const SEM_CHAVE = ["sinais_historico", "alertas", "scraper_status"] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function reservarLote(db: any, id: string, janelaMin: number | null): Promise<"nova" | "duplicada"> {
  await db.from("ingest_lotes").delete().lt("recebido_em", new Date(Date.now() - 30 * 86400000).toISOString());
  if (janelaMin) await db.from("ingest_lotes").delete().eq("id", id).lt("recebido_em", new Date(Date.now() - janelaMin * 60000).toISOString());
  const { error } = await db.from("ingest_lotes").insert({ id });
  if (!error) return "nova";
  if (error.code === "23505") return "duplicada";
  throw new Error(`lote: ${error.message}`);
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

        const raw = await request.text();
        let body: unknown;
        try {
          body = JSON.parse(raw);
        } catch {
          return Response.json({ erro: "JSON inválido" }, { status: 400 });
        }
        const parsed = payloadSchema.safeParse(body);
        if (!parsed.success) {
          return Response.json({ erro: "payload inválido", detalhes: parsed.error.issues.slice(0, 5) }, { status: 400 });
        }
        const p = parsed.data;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const explicita = request.headers.get("idempotency-key")?.trim().slice(0, 200) || null;
        const loteId = explicita ?? `corpo:${createHash("sha256").update(raw).digest("hex")}`;
        try {
          if ((await reservarLote(supabaseAdmin, loteId, explicita ? null : JANELA_HASH_MIN)) === "duplicada") {
            return Response.json({ ok: true, duplicado: true, gravados: {} });
          }
        } catch (e) {
          return Response.json({ erro: e instanceof Error ? e.message : "falha ao registrar o lote" }, { status: 500 });
        }

        const resultado: Record<string, number | string> = {};
        const falha = async (erro: string) => {
          // Libera o lote para que o retry do robô reprocesse (os upserts abaixo são seguros para repetir).
          await supabaseAdmin.from("ingest_lotes").delete().eq("id", loteId);
          return Response.json({ erro }, { status: 500 });
        };

        // Sinais: upsert pela chave única (atualiza sinal existente ou cria novo)
        const sinais = p["sinais"];
        if (sinais?.length) {
          const { error } = await supabaseAdmin
            .from("sinais")
            .upsert(sinais as never, { onConflict: "chave" });
          if (error) return falha(`sinais: ${error.message}`);
          resultado["sinais"] = sinais.length;
        }

        // Tabelas com chave natural: upsert (repetir o envio atualiza, não duplica)
        for (const [tabela, onConflict] of Object.entries(CHAVE_NATURAL)) {
          let linhas = p[tabela as keyof typeof CHAVE_NATURAL] as Record<string, unknown>[] | undefined;
          if (!linhas?.length) continue;
          if (tabela === "opcoes_grade") linhas = linhas.map((l) => ({ ...l, data_coleta: l["data_coleta"] ?? diaSP(new Date()) }));
          // Duas linhas com a mesma chave no mesmo lote fariam o Postgres recusar o upsert: fica a última.
          const unicas = deduplicarPorChave(linhas, onConflict.split(","), { tipo: "dividendo" });
          const { error } = await supabaseAdmin.from(tabela as keyof typeof CHAVE_NATURAL).upsert(unicas as never, { onConflict });
          if (error) return falha(`${tabela}: ${error.message}`);
          resultado[tabela] = unicas.length;
        }

        // Tabelas de eventos sem chave natural: inserção protegida pelo lote
        for (const tabela of SEM_CHAVE) {
          const linhas = p[tabela];
          if (!linhas?.length) continue;
          const { error } = await supabaseAdmin.from(tabela).insert(linhas as never);
          if (error) return falha(`${tabela}: ${error.message}`);
          resultado[tabela] = linhas.length;
        }

        // Sinais cujo vencimento passou ganham o resultado real.
        try {
          const l = await liquidarVencidos(supabaseAdmin);
          if (l.liquidados) resultado["liquidados"] = l.liquidados;
        } catch (e) {
          resultado["aviso_liquidacao"] = e instanceof Error ? e.message : "falha";
        }

        return Response.json({ ok: true, gravados: resultado });
      },
    },
  },
});
