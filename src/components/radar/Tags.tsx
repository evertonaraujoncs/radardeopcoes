import { asArr, nomeRisco } from "@/lib/format";

export function Tag({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "gain" | "loss" | "warn" }) {
  const cls = {
    neutral: "border-border bg-secondary text-secondary-foreground",
    gain: "border-gain/40 bg-gain/10 text-gain",
    loss: "border-loss/40 bg-loss/10 text-loss",
    warn: "border-warn/40 bg-warn/10 text-warn",
  }[tone];
  return <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] leading-none ${cls}`}>{children}</span>;
}

export function MotivosRiscos({ motivos, riscos }: { motivos: unknown; riscos: unknown }) {
  const m = asArr<string>(motivos);
  const r = asArr<string>(riscos);
  if (!m.length && !r.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {m.map((x) => <Tag key={x} tone="gain">{x}</Tag>)}
      {r.map((x) => <Tag key={x} tone="loss">{nomeRisco(x)}</Tag>)}
    </div>
  );
}

export function ScoreBadge({ score, apagado }: { score: number | null; apagado?: boolean }) {
  const s = score == null ? null : Math.round(Number(score));
  const tone = apagado ? "text-muted-foreground border-border" : s == null ? "" : s >= 70 ? "text-gain border-gain/50" : s >= 50 ? "text-warn border-warn/50" : "text-loss border-loss/50";
  return (
    <div className={`num flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg border-2 ${tone}`}>
      <span className="text-lg font-bold leading-none">{s ?? "—"}</span>
      <span className="text-[9px] uppercase tracking-wider opacity-70">score</span>
    </div>
  );
}
