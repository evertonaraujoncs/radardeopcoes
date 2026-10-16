import { fmtBRL, fmtNum, type Perna } from "@/lib/format";
import { normalizarPernas } from "@/lib/payoff";

export function Pernas({ pernas, compact }: { pernas: Perna[]; compact?: boolean }) {
  const itens = normalizarPernas(pernas);
  if (!itens.length) return <p className="text-sm text-muted-foreground">Estrutura não recebida ou incompleta.</p>;
  if (!compact) return (
    <ol className="divide-y divide-border">
      {itens.map((p, i) => (
        <li key={i} className="py-3 first:pt-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={`text-sm font-semibold ${p.lado > 0 ? "text-gain" : "text-loss"}`}>{p.lado > 0 ? "Compra" : "Venda"} de {p.tipo === "ACAO" ? "ações" : p.tipo}</span>
            <span className="num text-xs text-muted-foreground">{p.qtd} lote{p.qtd > 1 ? "s" : ""} · {p.qtd * 100} {p.tipo === "ACAO" ? "ações" : "opções"}</span>
          </div>
          <p className="num mt-1 text-sm font-medium">{p.ticker || "Código da opção não recebido"}</p>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
            <div><dt className="text-muted-foreground">Preço de exercício</dt><dd className="num mt-0.5">{p.tipo === "ACAO" ? "—" : fmtBRL(p.strike)}</dd></div>
            <div><dt className="text-muted-foreground">{p.tipo === "ACAO" ? "Preço por ação" : "Prêmio por opção"}</dt><dd className="num mt-0.5">{fmtBRL(p.preco)}</dd></div>
          </dl>
        </li>
      ))}
    </ol>
  );
  return (
    <ul className={`num space-y-0.5 ${compact ? "text-xs" : "text-sm"}`}>
      {itens.map((p, i) => (
        <li key={i} className="flex flex-wrap gap-x-2 gap-y-1">
          <span className={p.lado > 0 ? "text-gain w-14" : "text-loss w-14"}>{p.lado > 0 ? "COMPRA" : "VENDA"}</span>
          <span className="text-muted-foreground">{p.qtd}×</span>
          <span className="font-semibold">{p.ticker || "Código não recebido"}</span>
          <span className="text-muted-foreground">{p.tipo}</span>
          {p.strike != null && <span>K {fmtNum(p.strike)}</span>}
          <span className="ml-auto text-muted-foreground">@ {fmtNum(p.preco)}</span>
        </li>
      ))}
    </ul>
  );
}
