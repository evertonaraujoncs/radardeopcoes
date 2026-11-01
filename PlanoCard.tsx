import { fmtBRL, fmtDate } from "@/lib/format";
import type { PlanoOperacao } from "@/lib/metodo";
import { Tag } from "./Tags";

/** Plano da operação do método: as cinco perguntas respondidas antes de entrar, com stop e alvo no ATIVO. */
export function PlanoCard({ plano }: { plano: unknown }) {
  const p = plano && typeof plano === "object" ? (plano as PlanoOperacao) : null;
  if (!p?.perguntas) return null;
  const nivel = (l: string, v: number | null | undefined, tone: "loss" | "gain") =>
    v == null ? null : (
      <div className="min-w-0">
        <dt className="text-[10px] uppercase tracking-wider text-muted-foreground font-sans">{l}</dt>
        <dd className={`num font-semibold ${tone === "loss" ? "text-loss" : "text-gain"}`}>{fmtBRL(v)}</dd>
      </div>
    );
  const itens: [string, string][] = [
    ["1. Quanto posso perder", p.perguntas.risco],
    ["2. O que a análise mostra", p.perguntas.analise],
    ["3. Onde está o stop", p.perguntas.stop],
    ["4. Manejo", p.perguntas.manejo],
    ["5. Alvo e saída", p.perguntas.alvo],
  ];
  return (
    <section className="rounded-lg border bg-card p-4 space-y-3" aria-label="Plano da operação">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">Plano da operação</h2>
        <Tag tone="neutral">tese: {p.tese.toLowerCase()}</Tag>
        {p.tendencia && <Tag tone="neutral">ativo em {p.tendencia}</Tag>}
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {nivel("Stop no ativo", p.stop_ativo, "loss")}
        {nivel("Stop alto (condor)", p.stop_ativo_alto, "loss")}
        {nivel("Alvo no ativo", p.alvo_ativo, "gain")}
        <div className="min-w-0">
          <dt className="text-[10px] uppercase tracking-wider text-muted-foreground font-sans">Desmontar até</dt>
          <dd className="num font-semibold">{fmtDate(p.desmontar_ate)}</dd>
        </div>
      </dl>
      <ol className="space-y-2 text-sm">
        {itens.map(([t, v]) => (
          <li key={t}><span className="font-medium">{t}.</span> <span className="text-muted-foreground">{v}</span></li>
        ))}
      </ol>
      <p className="text-xs text-muted-foreground">O stop é do preço do ativo, não da opção. Operação de débito não tem manejo: sai no stop ou no alvo. Nunca leve ao exercício.</p>
    </section>
  );
}
