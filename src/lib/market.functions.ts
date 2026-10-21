import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { validateOptionGrid, parseOptionTickers, parseYahooNews, parseYahooEvents } from "./market-data";
import { providerBlocked, retryAfterSeconds, readSchedule, canRecalculateSignals } from "./collection-policy";
import { gerarSinais, calcularAlertas, ivRankSerie, num, PARAMS_PADRAO, ESTRATEGIAS, type Ctx, type LinhaGrade, type Params, type EstrategiaKey } from "./signal-engine";

const DEFASAGEM_DIAS = 4;

const CDI_REFERENCIA = 0.15; // usada quando o Banco Central está indisponível

async function obterCdi(): Promise<{ cdi: number; estimado: boolean }> {
  const manual = Number(process.env["CDI_ANUAL"]);
  if (Number.isFinite(manual) && manual > 0) return { cdi: manual > 1 ? manual / 100 : manual, estimado: false };
  try {
    const response = await fetch("https://api.bcb.gov.br/dados/serie/bcdata.sgs.4389/dados/ultimos/1?formato=json", { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const rows = JSON.parse(await response.text()) as { valor: string }[];
    const last = Array.isArray(rows) ? rows[rows.length - 1] : undefined;
    const v = Number(last?.valor?.replace(",", "."));
    if (!Number.isFinite(v) || v <= 0) throw new Error("valor ausente");
    return { cdi: v / 100, estimado: false };
  } catch {
    return { cdi: CDI_REFERENCIA, estimado: true };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rodarMotor(db: any, userDb: any, ticker: string) {
  const hojeStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const hoje = new Date(`${hojeStr}T00:00:00Z`);
  const desde = new Date(hoje.getTime() - DEFASAGEM_DIAS * 86400000).toISOString();
  const [ativo, grade, par, fund, divs, evs, news, hist, cdi] = await Promise.all([
    db.from("ativos").select("preco").eq("ticker", ticker).maybeSingle(),
    db.from("opcoes_grade").select("ticker,tipo,strike,vencimento,bid,ask,ultimo,negocios,iv,delta,data_coleta").eq("ativo_base", ticker).gte("data_coleta", desde).limit(5000),
    userDb.from("parametros").select("*").order("updated_at", { ascending: false }).limit(1),
    db.from("fundamentos").select("dy,valuation_score").eq("ticker", ticker).order("data", { ascending: false }).limit(1),
    db.from("dividendos").select("data_com").eq("ticker", ticker).gte("data_com", hojeStr),
    db.from("eventos").select("data,tipo").eq("ticker", ticker).gte("data", hojeStr),
    db.from("noticias").select("sentimento").eq("ticker", ticker).gte("publicado_em", new Date(hoje.getTime() - 7 * 86400000).toISOString()),
    db.from("opcoes_grade").select("data_coleta,iv,delta").eq("ativo_base", ticker).gte("data_coleta", new Date(hoje.getTime() - 365 * 86400000).toISOString()).not("iv", "is", null).not("delta", "is", null).limit(20000),
    obterCdi(),
  ]);
  for (const r of [ativo, grade, fund, divs, evs, news, hist]) if (r.error) throw new Error(r.error.message);
  const S0 = num(ativo.data?.preco);
  if (!S0) throw new Error("sem preço do ativo");
  // Mantém a cotação mais recente de cada opção dentro da janela de defasagem.
  const ultimas = new Map<string, LinhaGrade>();
  for (const row of (grade.data ?? []) as LinhaGrade[]) {
    const prev = ultimas.get(row.ticker);
    if (!prev || row.data_coleta > prev.data_coleta) ultimas.set(row.ticker, row);
  }
  if (!ultimas.size) throw new Error(`sem grade de opções negociada nos últimos ${DEFASAGEM_DIAS} dias`);
  const params: Params = { ...PARAMS_PADRAO };
  const p0 = par.data?.[0];
  if (p0) {
    if (p0.capital != null) params.capital = Number(p0.capital);
    params.risco_max_pct = Number(p0.risco_max_pct ?? params.risco_max_pct);
    params.liquidez_min_negocios = Number(p0.liquidez_min_negocios ?? params.liquidez_min_negocios);
    params.spread_max_pct = Number(p0.spread_max_pct ?? params.spread_max_pct);
    params.prob_lucro_min = Number(p0.prob_lucro_min ?? params.prob_lucro_min);
    if (Array.isArray(p0.estrategias_ativas)) params.estrategias_ativas = (p0.estrategias_ativas as string[]).filter((k): k is EstrategiaKey => k in ESTRATEGIAS);
  }
  const dy = num(fund.data?.[0]?.dy);
  const sents = ((news.data ?? []) as { sentimento: unknown }[]).map(n => num(n.sentimento)).filter((x): x is number => x !== null);
  const ctx: Ctx = {
    q: dy === null ? 0 : dy > 1 ? dy / 100 : dy,
    valuation_score: num(fund.data?.[0]?.valuation_score),
    sentimento: sents.length ? sents.reduce((a, b) => a + b, 0) / sents.length : null,
    datas_com: ((divs.data ?? []) as { data_com: string }[]).map(d => new Date(`${d.data_com}T00:00:00Z`)),
    datas_balanco: ((evs.data ?? []) as { data: string; tipo: string }[]).filter(e => ["balanco", "resultados"].includes(e.tipo)).map(e => new Date(`${e.data}T00:00:00Z`)),
    ivr: ivRankSerie(hist.data ?? []),
  };
  const r = Math.log(1 + cdi.cdi);
  const sinais = await gerarSinais(ticker, S0, [...ultimas.values()], ctx, params, hoje, r);

  const agora = new Date().toISOString();
  const ex = await db.from("sinais").select("id,chave,score,ticker,estrategia").eq("status", "ativo").eq("ticker", ticker);
  if (ex.error) throw new Error(ex.error.message);
  const existentes = new Map<string, { id: number; score: number | null; ticker: string; estrategia: string }>((ex.data ?? []).map((e: { chave: string; id: number; score: number | null; ticker: string; estrategia: string }) => [e.chave, e]));
  const novos = new Map(sinais.map(s => [s.chave, s]));
  const { alertas, encerrar } = calcularAlertas(existentes, novos);
  const ids = new Map<string, number>([...existentes].map(([k, e]) => [k, e.id]));
  if (sinais.length) {
    const rows = sinais.map(s => ({ chave: s.chave, ticker: s.ticker, estrategia: s.estrategia, vencimento: s.vencimento, pernas: s.pernas, dias_vencimento: s.dias_vencimento, preco_ativo: s.preco_ativo, credito_debito: s.credito_debito, lucro_max: s.lucro_max, perda_max: s.perda_max, breakevens: s.breakevens, prob_lucro: s.prob_lucro, valor_esperado: s.valor_esperado, retorno_sobre_risco: s.retorno_sobre_risco, iv_rank: s.iv_rank, score: s.score, fatores: s.fatores, gregas: s.gregas, curva_payoff: s.curva_payoff, motivos: s.motivos, riscos: s.riscos, status: "ativo", atualizado_em: agora }));
    const up = await db.from("sinais").upsert(rows, { onConflict: "chave" }).select("id,chave");
    if (up.error) throw new Error(up.error.message);
    for (const row of up.data ?? []) ids.set(row.chave, row.id);
    const h = await db.from("sinais_historico").insert(sinais.filter(s => ids.has(s.chave)).map(s => ({ sinal_id: ids.get(s.chave), score: s.score, prob_lucro: s.prob_lucro, preco_ativo: s.preco_ativo })));
    if (h.error) throw new Error(h.error.message);
  }
  if (encerrar.length) {
    const e = await db.from("sinais").update({ status: "encerrado", atualizado_em: agora }).in("chave", encerrar);
    if (e.error) throw new Error(e.error.message);
  }
  const feitos = await db.from("alertas").select("sinal_id,tipo").gte("criado_em", `${hojeStr}T00:00:00`);
  const ja = new Set(((feitos.data ?? []) as { sinal_id: number; tipo: string }[]).map(a => `${a.sinal_id}:${a.tipo}`));
  const novosAlertas = alertas.filter(a => ids.has(a.chave) && !ja.has(`${ids.get(a.chave)}:${a.tipo}`)).map(a => ({ sinal_id: ids.get(a.chave), tipo: a.tipo, mensagem: a.mensagem }));
  if (novosAlertas.length) {
    const a = await db.from("alertas").insert(novosAlertas);
    if (a.error) throw new Error(a.error.message);
  }
  return { sinais: sinais.length, encerrados: encerrar.length, alertas: novosAlertas.length, cdi: cdi.cdi, cdiEstimado: cdi.estimado, semBidAsk: sinais.some(s => s.riscos.includes("preco_sem_bid_ask")) };
}

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
  .inputValidator((input: unknown) => z.object({ ticker: z.string().regex(/^[A-Z]{4}\d{1,2}$/), optionsOnly: z.boolean().optional() }).parse(input))
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
    const reservation = await db.rpc("claim_options_collection", { p_ticker: ticker });
    if (reservation.error) throw new Error("Não foi possível reservar a coleta. Nenhuma consulta foi enviada à fonte.");
    const schedule = readSchedule(reservation.data);
    if (schedule.kind !== "ready") return { ticker, signalsCount: 0, historyCount, optionsCount, newsCount, eventsCount, warnings: [], notes: "", schedule, retry: false, circuit: schedule.circuit ?? false, nextAt: schedule.until };
    const token = schedule.token;
    if (!token) throw new Error("Reserva da coleta indisponível.");
    let blocked = false;
    let retrySeconds = 0;
    let outcome = "error";
    let validatedQuotes = 0;
    const optionsJson = async (url: string) => {
      const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json", "Referer": "https://opcoes.net.br/opcoes/bovespa" }, signal: AbortSignal.timeout(20000) });
      const text = await response.text();
      if (providerBlocked(response.status, text)) {
        blocked = true;
        retrySeconds = retryAfterSeconds(response.headers.get("Retry-After"));
        throw new Error("A fonte limitou as consultas; novas tentativas respeitarão a pausa indicada.");
      }
      if (!response.ok) throw new Error(`Fonte retornou HTTP ${response.status}`);
      return JSON.parse(text);
    };
    const json = async (url: string) => {
      const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`Fonte retornou HTTP ${response.status}`);
      return response.json();
    };
    try { if (!data.optionsOnly) {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}.SA?range=1y&interval=1d`;
      const payload = await json(url);
      const result = payload.chart?.result?.[0];
      const quotes = result?.indicators?.quote?.[0];
      if (!result || !quotes || !Number.isFinite(result.meta?.regularMarketPrice) || !Number.isFinite(result.meta?.regularMarketTime)) throw new Error("Cotação ausente na fonte");
      const history = (result.timestamp ?? []).flatMap((timestamp: number, i: number) => Number.isFinite(quotes.close?.[i]) ? [{ momento: new Date(timestamp * 1000).toISOString(), abertura: quotes.open?.[i] ?? null, maxima: quotes.high?.[i] ?? null, minima: quotes.low?.[i] ?? null, fechamento: quotes.close[i], volume: quotes.volume?.[i] ?? null }] : []);
      const { error } = await db.from("ativos").upsert({ ticker, nome: result.meta.longName ?? result.meta.shortName ?? ticker, preco: result.meta.regularMarketPrice, atualizado_em: new Date(result.meta.regularMarketTime * 1000).toISOString(), historico_precos: history, fonte_preco: url }, { onConflict: "ticker" });
      if (error) throw error;
      historyCount = history.length;
    }
    } catch (error) { warnings.push(`Cotações: ${error instanceof Error ? error.message : "falha na coleta"}`); }
    try {
      const base = `https://opcoes.net.br/listaopcoes/completa?idAcao=${ticker}`;
       const expiries = await optionsJson(`${base}&listarVencimentos=true&cotacoes=false`);
      if (expiries.success !== true || !Array.isArray(expiries.data?.vencimentos)) throw new Error("Vencimentos indisponíveis");
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
      const selected = expiries.data.vencimentos.filter((v: { value: string }) => /^\d{4}-\d{2}-\d{2}$/.test(v.value) && v.value >= today).slice(0, 3);
      for (const expiry of selected) {
        const payload = await optionsJson(`${base}&listarVencimentos=false&cotacoes=true&vencimentos=${expiry.value}`);
        if (payload.success !== true || !Array.isArray(payload.data?.cotacoesOpcoes)) throw new Error("Grade indisponível");
        const rows = validateOptionGrid(payload.data.cotacoesOpcoes, ticker, expiry.value, now);
        validatedQuotes += rows.length;
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
      if (validatedQuotes) outcome = "success";
      else warnings.push("Opções: a grade não contém cotações com data de negócio confirmada; dados e sinais existentes preservados.");
    } catch (error) { warnings.push(`Opções: ${error instanceof Error ? error.message : "falha na coleta"}`); }
    const finished = await db.rpc("finish_options_collection", { p_ticker: ticker, p_token: token, p_outcome: blocked ? "blocked" : outcome, p_retry_seconds: retrySeconds });
    if (finished.error) throw new Error("Não foi possível registrar a pausa da coleta; aguarde cinco minutos antes de tentar novamente.");
    const finishData = finished.data as { until?: string; retry?: boolean; circuit?: boolean } | null;
    try { if (!data.optionsOnly) {
      const payload = await json(`https://query1.finance.yahoo.com/v1/finance/search?q=${ticker}.SA&newsCount=20&quotesCount=0`);
      const rows = parseYahooNews(payload, ticker);
      const existing = await db.from("noticias").select("url").eq("ticker", ticker);
      if (existing.error) throw existing.error;
      const urls = new Set(existing.data.map(row => row.url));
      const fresh = rows.filter(row => { if (urls.has(row.url)) return false; urls.add(row.url); return true; });
      if (fresh.length) { const saved = await db.from("noticias").insert(fresh); if (saved.error) throw saved.error; }
      newsCount = fresh.length;
      if (!rows.length) warnings.push("Notícias: Yahoo não retornou notícias vinculadas a este ticker; cobertura não confirmada.");
    }
    } catch (error) { warnings.push(`Notícias Yahoo: ${error instanceof Error ? error.message : "falha na coleta"}`); }
    try { if (!data.optionsOnly) {
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
    }
    } catch (error) { warnings.push(`Eventos Yahoo: ${error instanceof Error ? error.message : "falha na coleta"}`); }
    let signalsCount = 0;
    let motorNota = "";
    try { if (canRecalculateSignals(blocked, outcome)) {
      const m = await rodarMotor(db, context.supabase, ticker);
      signalsCount = m.sinais;
      motorNota = `Motor de sinais: ${m.sinais} sinais ativos, ${m.encerrados} encerrados, ${m.alertas} alertas (CDI ${(m.cdi * 100).toFixed(2)}%${m.cdiEstimado ? " estimado — Banco Central indisponível" : ""})${m.semBidAsk ? "; preços sem bid/ask usam último negócio com margem de 5%" : ""}.`;
    } else {
      motorNota = "Motor preservado: sinais existentes não foram recalculados ou encerrados sem uma grade validada nesta coleta.";
    }
    } catch (error) { warnings.push(`Motor de sinais: ${error instanceof Error ? error.message : "falha no cálculo"}`); }
    const notes = `${motorNota} Yahoo Finance: ${historyCount} pregões (até 1 ano), ${newsCount} notícias e ${eventsCount} eventos novos; opcoes.net.br: ${optionsCount} novas cotações, até 3 vencimentos. ${warnings.join("; ")}`;
    const { error } = await db.from("scraper_status").insert({ ativo: ticker, executado_em: now, linhas: historyCount + optionsCount + newsCount + eventsCount, status: warnings.length ? "AVISO" : "OK", notas: notes });
    if (error) throw new Error("Não foi possível registrar o resultado da coleta.");
    return { ticker, signalsCount, historyCount, optionsCount, newsCount, eventsCount, warnings, notes, schedule, retry: finishData?.retry ?? false, circuit: finishData?.circuit ?? false, nextAt: finishData?.until };
  });