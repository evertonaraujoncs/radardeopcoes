import { describe, expect, it } from "vitest";
import { deduplicarPorChave } from "./dedupe";

describe("deduplicarPorChave", () => {
  it("mantém a última linha de cada chave e compara data_coleta só pelo dia", () => {
    const r = deduplicarPorChave([
      { ticker: "PETRA32", data_coleta: "2026-10-16T13:00:00Z", ultimo: 1 },
      { ticker: "PETRA32", data_coleta: "2026-10-16", ultimo: 2 },
      { ticker: "PETRA32", data_coleta: "2026-10-19", ultimo: 3 },
    ], ["ticker", "data_coleta"]);
    expect(r.map((x) => x["ultimo"])).toEqual([2, 3]);
  });
  it("não colapsa linhas sem valor na chave (notícias sem url)", () => {
    expect(deduplicarPorChave([{ url: null, t: "a" }, { url: null, t: "b" }], ["url"])).toHaveLength(2);
  });
  it("aplica o padrão da coluna ausente (tipo do dividendo)", () => {
    const r = deduplicarPorChave([{ ticker: "VALE3", data_com: "2026-11-01" }, { ticker: "VALE3", data_com: "2026-11-01", tipo: "dividendo" }], ["ticker", "data_com", "tipo"], { tipo: "dividendo" });
    expect(r).toHaveLength(1);
  });
});
