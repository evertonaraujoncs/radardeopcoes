import { describe, expect, it } from "vitest";
import { parseOptions, validateOptionGrid, parseOptionTickers, selectedTargets, parseYahooNews, parseYahooEvents, rankLiquidTargets, parseProviderChain } from "./market-data";

describe("collection selection", () => {
  it("ranks exactly 20 registered option assets by closing price times traded quantity, not alphabetical order", () => {
    const available = Array.from({ length: 25 }, (_, i) => `TICK${i}`);
    const stocks = available.map((stock, i) => ({ stock, volume: i + 1, close: 10 }));
    stocks.push({ stock: "FAKE3", volume: 999999, close: 100 });
    const liquid = rankLiquidTargets({ stocks }, available);
    expect(liquid).toEqual(available.slice(5).reverse());
    expect(selectedTargets(available, "top20", liquid)).toEqual(liquid);
    expect(selectedTargets(available, "top20", [...liquid, "FAKE3", ...liquid])).toHaveLength(20);
    expect(() => rankLiquidTargets({ stocks: stocks.slice(0, 19) }, available)).toThrow();
    expect(() => rankLiquidTargets({ stocks: [{ stock: available[0], close: 10, volume: null }] }, available)).toThrow();
  });
  it("collects only the selected ticker", () => {
    expect(selectedTargets(["PETR4", "VALE3"], "VALE3")).toEqual(["VALE3"]);
    expect(selectedTargets(["PETR4", "VALE3"], "FAKE3")).toEqual([]);
  });
  it("Todos collects the full available list", () => {
    expect(selectedTargets(["PETR4", "VALE3"], "all")).toEqual(["PETR4", "VALE3"]);
  });
  it("discovers only option tickers, deduplicated", () => {
    expect(parseOptionTickers("<loc>https://opcoes.net.br/opcoes/bovespa/VALE3</loc><loc>https://opcoes.net.br/opcoes/bovespa/PETR4</loc><loc>https://opcoes.net.br/opcoes/bovespa/VALE3</loc><loc>https://opcoes.net.br/acoes/FAKE3</loc>")).toEqual(["PETR4", "VALE3"]);
  });
});

describe("Yahoo coverage", () => {
  it("only saves attributed news with the original publication time", () => {
    const article = { title: "Resultados", link: "https://finance.yahoo.com/news/results", relatedTickers: ["PETR4.SA"], providerPublishTime: 1760000000 };
    expect(parseYahooNews({ news: [article] }, "PETR4")[0]).toMatchObject({ ticker: "PETR4", fonte: "Yahoo Finance · Yahoo", publicado_em: "2025-10-09T08:53:20.000Z", sentimento: null });
    expect(parseYahooNews({ news: [article] }, "VALE3")).toEqual([]);
    expect(parseYahooNews({ news: [{ ...article, providerPublishTime: undefined }] }, "PETR4")).toEqual([]);
  });
  it("only saves event dates returned by Yahoo", () => {
    expect(parseYahooEvents({ exDividendDate: { raw: 1760000000 } }, "PETR4")).toEqual([{ ticker: "PETR4", data: "2025-10-09", tipo: "data_ex_dividendo", descricao: "Data ex-dividendo · Yahoo Finance" }]);
    expect(parseYahooEvents(undefined, "PETR4")).toEqual([]);
  });
});

describe("public option feed", () => {
  it("maps provider column IDs to real IV and greeks, preserving missing bid/ask and quote dates", () => {
    const columns = ["suffix", "s", "p", "h", "n", "f", "i", "d", "g", "tf", "v"].map(id => ({ id }));
    const calls = Array.from({ length: 5 }, (_, i) => [`K${566 + i}`, 55.41, 4.98, "2026-10-21", 23, 442724, 0.489, 0.6789, 0.0449, -0.0902, 5.8398]);
    const payload = { success: true, requests: [{ type: "OptionsChain", results: { underlying_asset: { t: "PETR4" }, columns, expirations: [{ dt: "2026-11-19", calls, puts: [] }] } }] };
    const quotes = parseProviderChain(payload, "PETR4", "2026-10-22T00:00:00Z");
    expect(quotes).toHaveLength(5);
    expect(quotes[0]).toMatchObject({ ticker: "PETRK566", iv: 0.489, delta: 0.6789, gamma: 0.0449, theta: -0.0902, vega: 5.8398, bid: null, ask: null, data_coleta: "2026-10-21T03:00:00.000Z" });
    expect(() => parseProviderChain(payload, "VALE3", "now")).toThrow();
    expect(() => parseProviderChain({ ...payload, success: false }, "PETR4", "now")).toThrow();
  });
  it("preserves quote date and never invents locked fields", () => {
    const row = ["PETRJ253_2026", "", "CALL", "A", "ITM", 39, 0, 0, 1.25, 12, 500, "2026-10-15", "<img>"];
    const parsed = parseOptions([row], "PETR4", "2026-10-16", "2026-10-16T03:00:00Z");
    expect(parsed[0]).toMatchObject({ ticker: "PETRJ253", strike: 39, ultimo: 1.25, iv: null, delta: null, bid: null, ask: null, data_coleta: "2026-10-15T03:00:00.000Z" });
  });
  it("rejects malformed rows and unavailable quote timestamps", () => {
    expect(parseOptions([null, [], ["CODE", "", "PUT", "E", "OTM", 30, 0, 0, 1, 1, 1, "—"]], "PETR4", "2026-10-16", "now")).toEqual([]);
  });
  it("rejects the wrong asset instead of importing a page's default ticker", () => {
    expect(parseOptions([["VALEJ123", "", "CALL", "", "", 30, 0, 0, 1, 10, 100, "2026-10-15"]], "PETR4", "2026-11-20", "now")).toEqual([]);
  });
  it("requires at least five rows and 90% validated rows before shared writes", () => {
    const rows = Array.from({ length: 10 }, (_, i) => [`PETRK${100 + i}`, "", "CALL", "", "", 30, 0, 0, 1, 10, 100, "2026-10-15"]);
    expect(validateOptionGrid(rows, "PETR4", "2026-11-20", "now")).toHaveLength(10);
    expect(() => validateOptionGrid(rows.slice(0, 4), "PETR4", "2026-11-20", "now")).toThrow();
    expect(() => validateOptionGrid([...rows.slice(0, 8), null, null], "PETR4", "2026-11-20", "now")).toThrow();
  });
  it("allows untraded contracts in the universe but only saves provider-dated quotes", () => {
    const rows = Array.from({ length: 10 }, (_, i) => [`PETRK${100 + i}`, "", "CALL", "", "", 30, 0, 0, i < 5 ? null : 1, 10, 100, i < 5 ? null : "2026-10-15"]);
    expect(validateOptionGrid(rows, "PETR4", "2026-11-20", "2026-10-20T00:00:00Z")).toHaveLength(5);
    expect(validateOptionGrid(rows, "PETR4", "2026-11-20", "now")[0]?.data_coleta).toBe("2026-10-15T03:00:00.000Z");
  });
});