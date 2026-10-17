import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parseOptions, parseOptionTickers, parseYahooNews, parseYahooEvents } from "./market-data";

async function optionCatalog() {
  const response = await fetch("https://opcoes.net.br/sitemaps/acoes-com-opcoes.xml", { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Lista de ativos: HTTP ${response.status}`);
  const tickers = parseOptionTickers(await response.text());
  if (!tickers.length) throw new Error("A fonte não retornou a lista de ativos com opções.");
  return tickers;
}

export const collectionTargets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Authenticate before consulting the server-owned catalog or writing shared rows.
    const tickers = await optionCatalog();
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { error } = await db.from("ativos").upsert(tickers.map(ticker => ({ ticker })), { onConflict: "ticker", ignoreDuplicates: true });
    if (error) throw new Error("Não foi possível registrar a lista de ativos.");
    const readable = await context.supabase.from("ativos").select("ticker").in("ticker", tickers);
    if (readable.error) throw new Error("Não foi possível consultar os ativos para coleta.");
    return (readable.data ?? []).map(row => row.ticker).sort();
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
    let newsCount = 0;
    let eventsCount = 0;
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
        const keys = new Set((existing ?? []).map(r => `${r.ticker}:${r.data_coleta.slice(0, 10)}`));
        const fresh = rows.filter(r => {
          const key = `${r.ticker}:${r.data_coleta.slice(0, 10)}`;
          if (keys.has(key)) return false;
          keys.add(key);
          return true;
        });
        for (let i = 0; i < fresh.length; i += 500) {
          const { error } = await db.from("opcoes_grade").insert(fresh.slice(i, i + 500));
          if (error) throw error;
          optionsCount += fresh.slice(i, i + 500).length;
        }
      }
      if (!selected.length) warnings.push("Opções: sem vencimentos retornados pela fonte.");
    } catch (error) { warnings.push(`Opções: ${error instanceof Error ? error.message : "falha na coleta"}`); }
    try {
      const payload = await json(`https://query1.finance.yahoo.com/v1/finance/search?q=${ticker}.SA&newsCount=20&quotesCount=0`);
      const rows = parseYahooNews(payload, ticker);
      const existing = await db.from("noticias").select("url").eq("ticker", ticker);
      if (existing.error) throw existing.error;
      const urls = new Set(existing.data.map(row => row.url));
      const fresh = rows.filter(row => { if (urls.has(row.url)) return false; urls.add(row.url); return true; });
      if (fresh.length) { const saved = await db.from("noticias").insert(fresh); if (saved.error) throw saved.error; }
      newsCount = fresh.length;
      if (!rows.length) warnings.push("Notícias: Yahoo não retornou notícias vinculadas a este ticker; cobertura não confirmada.");
    } catch (error) { warnings.push(`Notícias Yahoo: ${error instanceof Error ? error.message : "falha na coleta"}`); }
    try {
      const payload = await json(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${ticker}.SA?modules=calendarEvents`);
      const calendar = payload.quoteSummary?.result?.[0]?.calendarEvents;
      if (!calendar) throw new Error("Calendário não disponibilizado pela fonte");
      const rows = parseYahooEvents(calendar, ticker);
      const existing = await db.from("eventos").select("data,tipo").eq("ticker", ticker);
      if (existing.error) throw existing.error;
      const keys = new Set(existing.data.map(row => `${row.data}:${row.tipo}`));
      const fresh = rows.filter(row => { const key = `${row.data}:${row.tipo}`; if (keys.has(key)) return false; keys.add(key); return true; });
      if (fresh.length) { const saved = await db.from("eventos").insert(fresh); if (saved.error) throw saved.error; }
      eventsCount = fresh.length;
      if (!rows.length) warnings.push("Eventos: Yahoo não retornou datas; cobertura não confirmada.");
    } catch (error) { warnings.push(`Eventos Yahoo: ${error instanceof Error ? error.message : "falha na coleta"}`); }
    const notes = `Yahoo Finance: ${historyCount} pregões (até 1 ano), ${newsCount} notícias e ${eventsCount} eventos novos; opcoes.net.br: ${optionsCount} novas cotações, até 3 vencimentos. Recomendações não recalculadas: fonte sem bid/ask e motor externo não integrado. ${warnings.join("; ")}`;
    const { error } = await db.from("scraper_status").insert({ ativo: ticker, executado_em: now, linhas: historyCount + optionsCount + newsCount + eventsCount, status: warnings.length ? "AVISO" : "OK", notas: notes });
    if (error) throw new Error("Não foi possível registrar o resultado da coleta.");
    return { ticker, historyCount, optionsCount, newsCount, eventsCount, warnings, notes };
  });