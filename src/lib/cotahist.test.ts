import { describe, expect, it } from "vitest";
import { deflateRawSync } from "node:zlib";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bsDelta, bsPreco, construirLinhas, diasUteis, ivImplicita, parseLinha, vencimentoMensal } from "./cotahist";
import { lerLinhas } from "./cotahist-io.server";

const pad = (s: string | number, n: number, direita = false) => (direita ? String(s).padEnd(n) : String(s).padStart(n, "0")).slice(0, n);
const centavos = (x: number, n = 13) => pad(Math.round(x * 100), n);

/** Monta uma linha de 245 caracteres no layout oficial do COTAHIST. */
function linha(o: { data: string; bdi: string; cod: string; tp: string; ult?: number; ofc?: number; ofv?: number; neg?: number; qtd?: number; exe?: number; ven?: string }): string {
  return "01" + o.data + pad(o.bdi, 2) + pad(o.cod, 12, true) + o.tp + pad("", 12, true) + pad("", 10, true) + "000" + "R$  "
    + centavos(0) + centavos(0) + centavos(0) + centavos(0) + centavos(o.ult ?? 0) + centavos(o.ofc ?? 0) + centavos(o.ofv ?? 0)
    + pad(o.neg ?? 0, 5) + pad(o.qtd ?? 0, 18) + pad(0, 18) + centavos(o.exe ?? 0) + "1" + (o.ven ?? "99991231") + "0000001" + pad(0, 13) + pad("", 12, true) + "000";
}
const CDI = Math.log(1.14);

describe("parseLinha", () => {
  it("lê os campos nas posições do layout e ignora header e trailer", () => {
    const l = linha({ data: "20261016", bdi: "78", cod: "PETRK300", tp: "070", ult: 0.85, ofc: 0.8, ofv: 0.9, neg: 42, qtd: 123400, exe: 30.5, ven: "20261120" });
    expect(l).toHaveLength(245);
    expect(parseLinha(l)).toEqual({ data: "2026-10-16", codbdi: "78", codneg: "PETRK300", tpmerc: "070", preult: 0.85, preofc: 0.8, preofv: 0.9, totneg: 42, quatot: 123400, preexe: 30.5, datven: "2026-11-20" });
    expect(parseLinha("00COTAHIST.2026BOVESPA 20261016" + " ".repeat(214))).toBeNull();
    expect(parseLinha("99COTAHIST.2026BOVESPA 20261016" + " ".repeat(214))).toBeNull();
  });
});

describe("Black-Scholes", () => {
  it("IV implícita recupera a volatilidade usada no preço; delta de call entre 0 e 1 e de put entre -1 e 0", () => {
    const T = 25 / 252;
    const px = bsPreco(30, 30.5, T, CDI, 0.35, "CALL");
    expect(ivImplicita(px, 30, 30.5, T, CDI, "CALL")!).toBeCloseTo(0.35, 4);
    const dc = bsDelta(30, 30.5, T, CDI, 0.35, "CALL"), dp = bsDelta(30, 29.5, T, CDI, 0.35, "PUT");
    expect(dc).toBeGreaterThan(0.3); expect(dc).toBeLessThan(0.7);
    expect(dp).toBeLessThan(0); expect(dp).toBeGreaterThan(-0.7);
    expect(ivImplicita(4.0, 30, 25, T, CDI, "CALL")).toBeNull(); // preço abaixo do valor intrínseco: sem IV possível
  });
  it("datas: dias úteis e vencimento mensal", () => {
    expect(diasUteis("2026-10-16", "2026-11-20")).toBe(25);
    expect(vencimentoMensal("2026-11-20")).toBe(true);
    expect(vencimentoMensal("2026-11-13")).toBe(false);
  });
});

describe("construirLinhas", () => {
  const spot = linha({ data: "20261016", bdi: "02", cod: "PETR4", tp: "010", ult: 30 });
  const call = linha({ data: "20261016", bdi: "78", cod: "PETRK300", tp: "070", ult: 0.85, ofc: 0.8, ofv: 0.9, neg: 42, qtd: 123400, exe: 30.5, ven: "20261120" });
  const putSemBook = linha({ data: "20261016", bdi: "82", cod: "PETRW295", tp: "080", ult: 0.6, neg: 7, qtd: 5000, exe: 29.5, ven: "20261120" });

  it("monta bid/ask do fechamento, negócios e IV/delta; sem book usa o último negócio", () => {
    const r = construirLinhas([spot, call, putSemBook], CDI);
    expect(r).toHaveLength(2);
    const [c, p] = r;
    expect(c).toMatchObject({ ticker: "PETRK300", ativo: "PETR4", ativo_base: "PETR4", tipo: "CALL", strike: 30.5, vencimento: "2026-11-20", data_coleta: "2026-10-16", ultimo: 0.85, bid: 0.8, ask: 0.9, negocios: 42, volume: 123400, fonte: "B3 COTAHIST" });
    expect(c!.iv).toBeGreaterThan(0.1); expect(c!.iv).toBeLessThan(1.5);
    expect(c!.delta).toBeGreaterThan(0); expect(c!.delta).toBeLessThan(1);
    expect(p).toMatchObject({ tipo: "PUT", bid: null, ask: null, ultimo: 0.6 });
    expect(p!.delta).toBeLessThan(0);
  });
  it("descarta o que o Radar não usa", () => {
    const venc7d = linha({ data: "20261016", bdi: "78", cod: "PETRK305", tp: "070", ult: 0.5, neg: 5, exe: 30.5, ven: "20261023" });
    const longe = linha({ data: "20261016", bdi: "78", cod: "PETRK400", tp: "070", ult: 0.5, neg: 5, exe: 40, ven: "20261120" });
    const outroAtivo = linha({ data: "20261016", bdi: "78", cod: "ABEVK120", tp: "070", ult: 0.5, neg: 5, exe: 12, ven: "20261120" });
    const semanal = linha({ data: "20261016", bdi: "78", cod: "PETRK306", tp: "070", ult: 0.5, neg: 5, exe: 30.5, ven: "20261113" });
    const semSpot = linha({ data: "20261019", bdi: "78", cod: "PETRK300", tp: "070", ult: 0.5, neg: 5, exe: 30.5, ven: "20261120" });
    expect(construirLinhas([spot, venc7d, longe, outroAtivo, semanal, semSpot], CDI)).toEqual([]);
  });
  it("ordem do arquivo não importa (o fechamento do ativo pode vir depois das opções)", () => {
    expect(construirLinhas([call, spot], CDI)).toHaveLength(1);
  });
});

describe("lerLinhas", () => {
  it("lê .txt e .zip (deflate) em ISO-8859-1 sem carregar tudo em memória", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cotahist-"));
    const linhas = [linha({ data: "20261016", bdi: "02", cod: "PETR4", tp: "010", ult: 30 }), linha({ data: "20261016", bdi: "02", cod: "VALE3", tp: "010", ult: 61.5 })];
    const texto = linhas.join("\r\n") + "\r\n";
    const txt = join(dir, "COTAHIST_D16102026.TXT");
    writeFileSync(txt, texto, "latin1");
    const dados = deflateRawSync(Buffer.from(texto, "latin1")), nome = Buffer.from("COTAHIST_D16102026.TXT");
    const cab = Buffer.alloc(30);
    cab.writeUInt32LE(0x04034b50, 0); cab.writeUInt16LE(20, 4); cab.writeUInt16LE(8, 8);
    cab.writeUInt32LE(dados.length, 18); cab.writeUInt32LE(texto.length, 22); cab.writeUInt16LE(nome.length, 26);
    const zip = join(dir, "COTAHIST_D16102026.ZIP");
    writeFileSync(zip, Buffer.concat([cab, nome, dados]));
    for (const caminho of [txt, zip]) {
      const lidas: string[] = [];
      for await (const l of lerLinhas(caminho)) lidas.push(l);
      expect(lidas).toEqual(linhas);
    }
    writeFileSync(join(dir, "ruim.zip"), Buffer.from("isso não é um zip, mas tem mais de trinta bytes de conteúdo"));
    await expect((async () => { for await (const _ of lerLinhas(join(dir, "ruim.zip"))) void _; })()).rejects.toThrow("ZIP inválido");
  });
});
