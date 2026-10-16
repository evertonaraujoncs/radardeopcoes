import type { Perna } from "./format";

export function normalizarPernas(value: unknown): Perna[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const p = item as Record<string, unknown>;
    const tipo = String(p['tipo'] ?? "").toUpperCase();
    const side = String(p['lado'] ?? "").toLowerCase();
    const lado = side === "compra" ? 1 : side === "venda" ? -1 : Number(p['lado']);
    const qtd = p['qtd'] == null ? 1 : Number(p['qtd']);
    const preco = p['preco'] == null ? NaN : Number(p['preco']);
    const strike = p['strike'] == null ? null : Number(p['strike']);
    if (!["ACAO", "CALL", "PUT"].includes(tipo) || ![1, -1].includes(lado) ||
      !Number.isFinite(qtd) || qtd <= 0 || !Number.isFinite(preco) || preco < 0 ||
      (tipo !== "ACAO" && (strike == null || !Number.isFinite(strike) || strike < 0))) return [];
    return [{ tipo, lado, qtd, preco, strike, ticker: String(p['ticker'] ?? ""), iv: p['iv'] == null ? null : Number(p['iv']) }];
  });
}

export function payoffNoVencimento(pernas: Perna[], preco: number): number {
  return pernas.reduce((total, p) => {
    const valor = p['tipo'] === "ACAO" ? preco : p['tipo'] === "CALL"
      ? Math.max(0, preco - (p['strike'] ?? 0)) : Math.max(0, (p['strike'] ?? 0) - preco);
    return total + p['lado'] * p['qtd'] * (valor - p['preco']) * 100;
  }, 0);
}

export function curvaPayoff(pernas: Perna[], precoAtual: number, pontos: number[] = []): [number, number][] {
  if (!pernas.length || !Number.isFinite(precoAtual) || precoAtual <= 0) return [];
  const marcos = [precoAtual, ...pernas.flatMap((p) => p['strike'] == null ? [] : [p['strike']]), ...pontos].filter(Number.isFinite);
  const lo = Math.max(0, Math.min(...marcos) * 0.75);
  const hi = Math.max(...marcos) * 1.25;
  const precos = new Set([...marcos, ...Array.from({ length: 81 }, (_, i) => lo + (hi - lo) * i / 80)]);
  return [...precos].sort((a, b) => a - b).map((preco) => [preco, payoffNoVencimento(pernas, preco)]);
}