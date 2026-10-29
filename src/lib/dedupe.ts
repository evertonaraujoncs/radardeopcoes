/**
 * Remove linhas repetidas pela chave natural dentro de um mesmo lote (a última vence).
 * Postgres recusa um upsert que toca a mesma linha duas vezes. Linhas sem valor em alguma coluna da chave
 * (ex.: notícia sem url) não são comparáveis e ficam todas.
 */
export function deduplicarPorChave<T extends Record<string, unknown>>(linhas: T[], colunas: string[], padroes: Record<string, string> = {}): T[] {
  const mapa = new Map<string, T>();
  linhas.forEach((linha, i) => {
    const partes = colunas.map((c) => {
      const v = linha[c] ?? padroes[c];
      return v == null || v === "" ? null : c === "data_coleta" ? String(v).slice(0, 10) : String(v);
    });
    mapa.set(partes.includes(null) ? `__linha_${i}` : partes.join("|"), linha);
  });
  return [...mapa.values()];
}
