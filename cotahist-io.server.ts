import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { createInflateRaw } from "node:zlib";
import { createInterface } from "node:readline";

/** Lê um COTAHIST (.zip de um arquivo só, ou .txt) linha a linha, sem carregar tudo em memória. O arquivo é ISO-8859-1. */
export async function* lerLinhas(caminho: string): AsyncGenerator<string> {
  let entrada: NodeJS.ReadableStream;
  if (/\.zip$/i.test(caminho)) {
    const fh = await open(caminho, "r");
    const cab = Buffer.alloc(30);
    await fh.read(cab, 0, 30, 0);
    await fh.close();
    if (cab.readUInt32LE(0) !== 0x04034b50) throw new Error("Arquivo ZIP inválido (cabeçalho não reconhecido).");
    const metodo = cab.readUInt16LE(8), inicio = 30 + cab.readUInt16LE(26) + cab.readUInt16LE(28);
    const bruto = createReadStream(caminho, { start: inicio });
    if (metodo === 8) { const inflate = createInflateRaw(); bruto.pipe(inflate); inflate.setEncoding("latin1"); entrada = inflate; }
    else if (metodo === 0) { bruto.setEncoding("latin1"); entrada = bruto; }
    else throw new Error(`Método de compressão ZIP não suportado (${metodo}).`);
  } else {
    entrada = createReadStream(caminho, { encoding: "latin1" });
  }
  for await (const linha of createInterface({ input: entrada, crlfDelay: Infinity })) yield linha;
}
