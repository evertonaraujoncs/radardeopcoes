import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { desatualizado, fmtDateTime, fmtInt, haQuanto } from "@/lib/format";
import { Tag } from "@/components/radar/Tags";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAgora } from "@/hooks/use-agora";

export const Route = createFileRoute("/_authenticated/status")({
  head: () => ({
    meta: [
      { title: "Status do robô — Radar de Opções B3" },
      { name: "description", content: "Últimas execuções do robô de coleta e seu estado." },
      { property: "og:title", content: "Status do robô — Radar de Opções B3" },
      { property: "og:description", content: "Últimas execuções do robô de coleta e seu estado." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StatusPage,
});

const tone = (s: string) => (s === "OK" ? "gain" : s === "QUEBRADO" ? "loss" : "warn") as "gain" | "loss" | "warn";

function StatusPage() {
  const agora = useAgora();
  const q = useQuery({
    queryKey: ["scraper_status", "lista"],
    queryFn: async () => {
      const { data, error } = await supabase.from("scraper_status").select("*").order("executado_em", { ascending: false }).limit(100);
      if (error) throw error;
      return data;
    },
  });
  const ult = q.data?.[0];
  const porAtivo = new Map<string, NonNullable<typeof ult>>();
  q.data?.forEach((r) => { const k = r.ativo ?? "—"; if (!porAtivo.has(k)) porAtivo.set(k, r); });

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">Status do robô</h1>
      <section className={`rounded-lg border p-5 ${!ult || ult.status === "QUEBRADO" || desatualizado(ult.executado_em, agora) ? "border-destructive bg-destructive/10" : "bg-card"}`}>
        {!ult ? <p>Nenhuma execução registrada ainda.</p> : (
          <div className="flex flex-wrap items-center gap-4">
            <Tag tone={tone(ult.status)}>{ult.status}</Tag>
            <span>Última execução <b>{haQuanto(ult.executado_em, agora)}</b> ({fmtDateTime(ult.executado_em)})</span>
            {desatualizado(ult.executado_em, agora) && <Tag tone="loss">sem coleta nas últimas 24h</Tag>}
          </div>
        )}
      </section>
      {porAtivo.size > 0 && (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[...porAtivo.entries()].map(([a, r]) => (
            <div key={a} className="rounded-lg border bg-card p-3">
              <div className="flex items-center justify-between"><span className="num font-semibold">{a}</span><Tag tone={tone(r.status)}>{r.status}</Tag></div>
              <p className="mt-1 text-xs text-muted-foreground">{haQuanto(r.executado_em, agora)} · {fmtInt(r.linhas)} linhas</p>
            </div>
          ))}
        </section>
      )}
      <section className="rounded-lg border bg-card p-4">
        <h2 className="mb-2 text-sm font-semibold">Histórico de execuções</h2>
        <Table><TableHeader><TableRow><TableHead>Quando</TableHead><TableHead>Ativo</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Linhas</TableHead><TableHead>Notas</TableHead></TableRow></TableHeader>
          <TableBody>{(q.data ?? []).map((r) => (
            <TableRow key={r.id}><TableCell className="num text-xs">{fmtDateTime(r.executado_em)}</TableCell><TableCell className="num">{r.ativo ?? "—"}</TableCell>
              <TableCell><Tag tone={tone(r.status)}>{r.status}</Tag></TableCell><TableCell className="num text-right">{fmtInt(r.linhas)}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{r.notas}</TableCell></TableRow>))}
          </TableBody></Table>
      </section>
    </div>
  );
}
