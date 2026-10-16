import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parseOptions } from "./market-data";

export const collectionTargets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [assets, signals] = await Promise.all([
      context.supabase.from("ativos").select("ticker"),
      context.supabase.from("sinais").select("ticker").eq("status", "ativo"),
    ]);
    if (assets.error || signals.error) throw new Error("Não foi possível consultar os ativos para coleta.");
    return [...new Set([...(assets.data ?? []), ...(signals.data ?? [])].map(a => a.ticker))].sort();
  });

export const collectMarket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ ticker: z.string().regex(/^[A-Z]{4}\d{1,2}$/) }).parse(input))
  .handler(async ({ data, context }) => {
    // Only collect registered, user-readable assets; no arbitrary URLs or submitted market values.
    const [asset, signal] = await Promise.all([
      context.supabase.from("ativos").select("ticker").eq("ticker", data.ticker).limit(1),
      context.supabase.from("sinais").select("ticker").eq("ticker", data.ticker).eq("status", "ativo").limit(1),
    ]);
    if (asset.error || signal.error || (!asset.data?.length && !signal.data?.length)) throw new Error("Ativo não disponível para coleta.");
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const ticker = data.ticker;
    const warnings: string[] = [];
    let historyCount = 0;
    let optionsCount = 0;
    const now = new Date().toISOString();
    const json = async (url: string) => {
      const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`Fonte retornou HTTP ${response.status}`);
      return response.json();
    };
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}.SA?range=1y&interval=1d`;
      const payload = await json(url);
      const result = payload.chart?.result?.[0];
      const quotes = result?.indicators?.quote?.[0];
      if (!result || !quotes || !Number.isFinite(result.meta?.regularMarketPrice) || !Number.isFinite(result.meta?.regularMarketTime)) throw new Error("Cotação ausente na fonte");
      const history = (result.timestamp ?? []).flatMap((timestamp: number, i: number) => Number.isFinite(quotes.close?.[i]) ? [{ momento: new Date(timestamp * 1000).toISOString(), abertura: quotes.open?.[i] ?? null, maxima: quotes.high?.[i] ?? null, minima: quotes.low?.[i] ?? null, fechamento: quotes.close[i], volume: quotes.volume?.[i] ?? null }] : []);
      const { error } = await db.from("ativos").upsert({ ticker, nome: result.meta.longName ?? result.meta.shortName ?? ticker, preco: result.meta.regularMarketPrice, atualizado_em: new Date(result.meta.regularMarketTime * 1000).toISOString(), historico_precos: history, fonte_preco: url }, { onConflict: "ticker" });
      if (error) throw error;
      historyCount = history.length;
    } catch (error) { warnings.push(`Cotações: ${error instanceof Error ? error.message : "falha na coleta"}`); }
    try {
      const base = `https://opcoes.net.br/listaopcoes/completa?idAcao=${ticker}`;
      const expiries = await json(`${base}&listarVencimentos=true&cotacoes=false`);
      if (expiries.success !== true || !Array.isArray(expiries.data?.vencimentos)) throw new Error("Vencimentos indisponíveis");
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
      const selected = expiries.data.vencimentos.filter((v: { value: string }) => /^\d{4}-\d{2}-\d{2}$/.test(v.value) && v.value >= today).slice(0, 3);
      for (const expiry of selected) {
        const payload = await json(`${base}&listarVencimentos=false&cotacoes=true&vencimentos=${expiry.value}`);
        if (payload.success !== true || !Array.isArray(payload.data?.cotacoesOpcoes)) throw new Error("Grade indisponível");
        const rows = parseOptions(payload.data.cotacoesOpcoes, ticker, expiry.value, now);
        const { data: existing, error: readError } = await db.from("opcoes_grade").select("ticker,data_coleta").eq("ativo_base", ticker).eq("vencimento", expiry.value);
        if (readError) throw readError;
        const keys = new Set((existing ?? []).map(r => `${r.ticker}:${Date.parse(r.data_coleta)}`));
        const fresh = rows.filter(r => !keys.has(`${r.ticker}:${Date.parse(r.data_coleta)}`));
        for (let i = 0; i < fresh.length; i += 500) {
          const { error } = await db.from("opcoes_grade").insert(fresh.slice(i, i + 500));
          if (error) throw error;
          optionsCount += fresh.slice(i, i + 500).length;
        }
      }
      if (!selected.length) warnings.push("Opções: sem vencimentos retornados pela fonte.");
    } catch (error) { warnings.push(`Opções: ${error instanceof Error ? error.message : "falha na coleta"}`); }
    const notes = `Yahoo Finance: ${historyCount} pregões (até 1 ano); opcoes.net.br: ${optionsCount} novas cotações, até 3 vencimentos. Notícias e eventos não conectados; IV, gregas e bid/ask não disponíveis. Sinais não recalculados. ${warnings.join("; ")}`;
    const { error } = await db.from("scraper_status").insert({ ativo: ticker, executado_em: now, linhas: historyCount + optionsCount, status: "PARCIAL", notas: notes });
    if (error) throw new Error("Não foi possível registrar o resultado da coleta.");
    return { ticker, historyCount, optionsCount, warnings, notes };
  });