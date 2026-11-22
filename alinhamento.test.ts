import { describe, expect, it } from "vitest";
import { alinharCotacoes, fechamentoDoDia, pregoesEntre } from "./alinhamento";

const candle = (dia: string, fechamento: number) => ({ momento: `${dia}T17:00:00.000Z`, fechamento });
const linha = (ticker: string, data_coleta: string) => ({ ticker, data_coleta });
const hist = [candle("2026-11-12", 30), candle("2026-11-13", 31.2), candle("2026-11-16", 29.8)];

describe("pregoesEntre", () => {
  it("conta dias úteis", () => {
    expect(pregoesEntre("2026-11-13", "2026-11-16")).toBe(1); // sexta -> segunda
    expect(pregoesEntre("2026-11-13", "2026-11-17")).toBe(2);
    expect(pregoesEntre("2026-11-16", "2026-11-16")).toBe(0);
  });
});

describe("fechamentoDoDia", () => {
  it("devolve o fechamento daquele dia e null quando não há candle", () => {
    expect(fechamentoDoDia(hist, "2026-11-13")).toBe(31.2);
    expect(fechamentoDoDia(hist, "2026-11-14")).toBeNull();
    expect(fechamentoDoDia(null, "2026-11-13")).toBeNull();
  });
});

describe("alinharCotacoes", () => {
  it("usa só o pregão mais recente e o fechamento do ativo nesse mesmo dia (não o preço de agora)", () => {
    const linhas = [linha("A", "2026-11-13"), linha("B", "2026-11-13"), linha("C", "2026-11-12"), linha("D", "2026-11-10")];
    const r = alinharCotacoes(linhas, hist, 29.8, "2026-11-16");
    expect(r.dataRef).toBe("2026-11-13");
    expect(r.linhas.map((l) => l.ticker)).toEqual(["A", "B"]);
    expect(r.descartadas).toBe(2);
    expect(r.spot).toBe(31.2); // fechamento de sexta, e não 29,8 de segunda
    expect(r.fonteSpot).toBe("fechamento");
    expect(r.pregoesDefasagem).toBe(1);
    expect(r.avisos).toEqual([]);
  });
  it("hoje sem candle do dia usa o preço atual", () => {
    const r = alinharCotacoes([linha("A", "2026-11-17")], hist, 30.5, "2026-11-17");
    expect(r.spot).toBe(30.5);
    expect(r.fonteSpot).toBe("preco_atual");
  });
  it("dia passado sem fechamento do ativo: sem spot e com aviso", () => {
    const r = alinharCotacoes([linha("A", "2026-11-14")], hist, 29.8, "2026-11-16");
    expect(r.spot).toBeNull();
    expect(r.avisos[0]).toContain("sem o fechamento");
  });
  it("grade velha demais não gera sinais", () => {
    const r = alinharCotacoes([linha("A", "2026-11-09")], hist, 29.8, "2026-11-16");
    expect(r.linhas).toEqual([]);
    expect(r.avisos[0]).toContain("defasagem");
  });
  it("sem cotações", () => {
    expect(alinharCotacoes([], hist, 29.8, "2026-11-16").linhas).toEqual([]);
  });
});
