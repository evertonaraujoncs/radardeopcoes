#!/usr/bin/env bun
/**
 * Importa o COTAHIST da B3 (gratuito) para o Radar de Opções: bid/ask do fechamento, negócios, IV e delta das opções do universo.
 *
 * Uso (Bun ou `npx tsx`):
 *   bun scripts/importar-cotahist.ts COTAHIST_D12112026.ZIP            # arquivo(s) baixados à mão do site da B3
 *   bun scripts/importar-cotahist.ts --baixar-ultimo                    # baixa o arquivo diário do último pregão disponível
 *   bun scripts/importar-cotahist.ts --baixar-meses 12                  # baixa os últimos 12 arquivos mensais (histórico de IV)
 *   bun scripts/importar-cotahist.ts --dry-run <...>                    # só mostra o que seria enviado
 *   bun scripts/importar-cotahist.ts --forcar <...>                     # reenvia mesmo se o lote já foi aceito antes
 *
 * Variáveis de ambiente:
 *   RADAR_URL    endereço do app (padrão https://radardeopcoes.lovable.app)
 *   INGEST_KEY   o mesmo segredo INGEST_KEY do app (cabeçalho x-ingest-key do endpoint /api/public/ingest)
 *   CDI_ANUAL    taxa livre de risco anual, ex. 0.14 (se ausente, busca no Banco Central; reserva: 0.14)
 *   B3_COTAHIST_BASE  pasta de download da B3 (padrão https://bvmf.bmfbovespa.com.br/InstDados/SerHist)
 */
import { createWriteStream, existsSync, mkdirSync, openSync, readSync, closeSync } from "node:fs";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { basename, join } from "node:path";
import { acumularSpot, linhaOpcao, parseLinha, UNIVERSO_COTAHIST, type LinhaGrade, type Spots } from "../src/lib/cotahist";
import { lerLinhas } from "../src/lib/cotahist-io.server";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const valor = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const DRY = flag("--dry-run"), FORCAR = flag("--forcar");
const BASE_B3 = (process.env["B3_COTAHIST_BASE"] ?? "https://bvmf.bmfbovespa.com.br/InstDados/SerHist").replace(/\/$/, "");
const CACHE = "cotahist-cache";
const PAGINA_B3 = "https://www.b3.com.br/pt_br/market-data-e-indices/servicos-de-dados/market-data/historico/mercado-a-vista/cotacoes-historicas/";

const pad2 = (n: number) => String(n).padStart(2, "0");
const hojeSP = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

async function baixar(nome: string): Promise<string | null> {
  mkdirSync(CACHE, { recursive: true });
  const destino = join(CACHE, nome);
  if (existsSync(destino)) return destino;
  try {
    const r = await fetch(`${BASE_B3}/${nome}`, { headers: { "User-Agent": "Mozilla/5.0 (radar-opcoes)" }, signal: AbortSignal.timeout(300000) });
    if (!r.ok || !r.body) { console.warn(`  ${nome}: HTTP ${r.status}`); return null; }
    const arq = createWriteStream(destino);
    await finished(Readable.fromWeb(r.body as never).pipe(arq));
    const fd = openSync(destino, "r"), b = Buffer.alloc(4); readSync(fd, b, 0, 4, 0); closeSync(fd);
    if (b.toString("latin1") !== "PK\u0003\u0004") { console.warn(`  ${nome}: o servidor não devolveu um ZIP`); return null; }
    return destino;
  } catch (e) { console.warn(`  ${nome}: ${e instanceof Error ? e.message : "falha no download"}`); return null; }
}

async function cdi(): Promise<number> {
  const env = Number(process.env["CDI_ANUAL"]);
  if (Number.isFinite(env) && env > 0) return env;
  try {
    const r = await fetch("https://api.bcb.gov.br/dados/serie/bcdata.sgs.4389/dados/ultimos/1?formato=json", { signal: AbortSignal.timeout(15000) });
    const j = (await r.json()) as { valor?: string }[];
    const v = Number(j[0]?.valor) / 100;
    if (Number.isFinite(v) && v > 0.01 && v < 0.6) return v;
  } catch { /* usa a reserva */ }
  return 0.14;
}

async function lerArquivo(caminho: string, taxa: number): Promise<LinhaGrade[]> {
  // Duas passagens: 1) fechamento dos ativos por dia; 2) opções do universo (a ordem do arquivo não é garantida).
  const spots: Spots = new Map();
  let total = 0;
  for await (const l of lerLinhas(caminho)) { total++; const r = parseLinha(l); if (r) acumularSpot(r, spots); }
  if (!total) throw new Error("arquivo vazio");
  if (!spots.size) throw new Error("nenhum fechamento de PETR4/VALE3/BBAS3/ITUB4/BBDC4/SANB11/BOVA11 encontrado: o layout do arquivo não foi reconhecido?");
  const out: LinhaGrade[] = [];
  for await (const l of lerLinhas(caminho)) { const r = parseLinha(l); const x = r && linhaOpcao(r, spots, taxa); if (x) out.push(x); }
  return out;
}

async function enviar(linhas: LinhaGrade[], origem: string) {
  const url = `${(process.env["RADAR_URL"] ?? "https://radardeopcoes.lovable.app").replace(/\/$/, "")}/api/public/ingest`;
  const chave = process.env["INGEST_KEY"];
  if (!chave) throw new Error("Defina INGEST_KEY (o mesmo segredo do app).");
  for (let i = 0; i < linhas.length; i += 4000) {
    const r = await fetch(url, {
      method: "POST", signal: AbortSignal.timeout(120000),
      headers: { "Content-Type": "application/json", "x-ingest-key": chave, "Idempotency-Key": `cotahist:${origem}:${i}${FORCAR ? `:${Date.now()}` : ""}` },
      body: JSON.stringify({ opcoes_grade: linhas.slice(i, i + 4000) }),
    });
    const corpo = await r.text();
    if (!r.ok) throw new Error(`ingest respondeu ${r.status}: ${corpo.slice(0, 300)}`);
    console.log(`  enviado ${Math.min(i + 4000, linhas.length)}/${linhas.length}${corpo.includes('"duplicado":true') ? " (lote já aceito antes; use --forcar para reenviar)" : ""}`);
  }
}

async function main() {
  const arquivos = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--baixar-meses");
  if (flag("--baixar-ultimo")) {
    const d = new Date(`${hojeSP()}T12:00:00Z`);
    let achou: string | null = null;
    for (let t = 0; t < 7 && !achou; t++, d.setUTCDate(d.getUTCDate() - 1)) {
      if ([0, 6].includes(d.getUTCDay())) continue;
      achou = await baixar(`COTAHIST_D${pad2(d.getUTCDate())}${pad2(d.getUTCMonth() + 1)}${d.getUTCFullYear()}.ZIP`);
    }
    if (!achou) throw new Error(`Não consegui baixar o arquivo diário da B3. Baixe à mão em ${PAGINA_B3} e rode com o caminho do arquivo.`);
    arquivos.push(achou);
  }
  const meses = Number(valor("--baixar-meses") ?? 0);
  if (meses > 0) {
    const d = new Date(`${hojeSP()}T12:00:00Z`);
    for (let m = 0; m < meses; m++, d.setUTCMonth(d.getUTCMonth() - 1)) {
      const f = await baixar(`COTAHIST_M${pad2(d.getUTCMonth() + 1)}${d.getUTCFullYear()}.ZIP`);
      if (f) arquivos.push(f);
    }
    if (!arquivos.length) throw new Error(`Nenhum arquivo mensal baixado. Baixe à mão em ${PAGINA_B3}.`);
  }
  if (!arquivos.length) { console.error("Informe arquivos do COTAHIST ou use --baixar-ultimo / --baixar-meses N. Veja o cabeçalho do script."); process.exit(2); }

  const taxa = Math.log(1 + (await cdi()));
  console.log(`Taxa livre de risco: ${(Math.exp(taxa) - 1) * 100 | 0}% a.a. (contínua ${taxa.toFixed(4)})`);
  let erros = 0;
  for (const arq of arquivos) {
    try {
      console.log(`\n${basename(arq)}`);
      const linhas = await lerArquivo(arq, taxa);
      const datas = [...new Set(linhas.map((l) => l.data_coleta))].sort();
      const porAtivo: Record<string, number> = {};
      for (const l of linhas) porAtivo[l.ativo] = (porAtivo[l.ativo] ?? 0) + 1;
      console.log(`  ${linhas.length} opções (${datas[0] ?? "-"} a ${datas[datas.length - 1] ?? "-"}), ${linhas.filter((l) => l.bid !== null).length} com bid/ask, ${linhas.filter((l) => l.iv !== null).length} com IV`);
      console.log(`  por ativo: ${Object.values(UNIVERSO_COTAHIST).map((a) => `${a}=${porAtivo[a] ?? 0}`).join(" ")}`);
      if (!linhas.length) { console.warn("  nenhuma opção do universo na janela de 15 a 60 dias; nada a enviar"); continue; }
      if (DRY) { console.log("  amostra:", JSON.stringify(linhas[Math.floor(linhas.length / 2)])); continue; }
      await enviar(linhas, basename(arq));
    } catch (e) { erros++; console.error(`  ERRO: ${e instanceof Error ? e.message : e}`); }
  }
  if (erros) process.exit(1);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
