import { fmtNum, type Perna } from "@/lib/format";

export function Pernas({ pernas, compact }: { pernas: Perna[]; compact?: boolean }) {
  return (
    <ul className={`num space-y-0.5 ${compact ? "text-xs" : "text-sm"}`}>
      {pernas.map((p, i) => (
        <li key={i} className="flex gap-2">
          <span className={p.lado > 0 ? "text-gain w-14" : "text-loss w-14"}>{p.lado > 0 ? "COMPRA" : "VENDA"}</span>
          <span className="text-muted-foreground">{p.qtd}×</span>
          <span className="font-semibold">{p.ticker}</span>
          <span className="text-muted-foreground">{p.tipo}</span>
          {p.strike != null && <span>K {fmtNum(p.strike)}</span>}
          <span className="ml-auto text-muted-foreground">@ {fmtNum(p.preco)}</span>
        </li>
      ))}
    </ul>
  );
}
