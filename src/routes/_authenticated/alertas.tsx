import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Bell, CalendarClock, CheckCheck, Sparkles, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fmtDateTime, haQuanto } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { useAgora } from "@/hooks/use-agora";

export const Route = createFileRoute("/_authenticated/alertas")({
  head: () => ({
    meta: [
      { title: "Alertas — Radar de Opções B3" },
      { name: "description", content: "Feed em tempo real de novos sinais, mudanças de score e eventos." },
      { property: "og:title", content: "Alertas — Radar de Opções B3" },
      { property: "og:description", content: "Feed em tempo real de novos sinais, mudanças de score e eventos." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AlertasPage,
});

const TIPOS: Record<string, { label: string; icon: typeof Bell; cls: string }> = {
  novo: { label: "Novo sinal", icon: Sparkles, cls: "text-primary" },
  score_subiu: { label: "Score subiu", icon: ArrowUp, cls: "text-gain" },
  score_caiu: { label: "Score caiu", icon: ArrowDown, cls: "text-loss" },
  encerrado: { label: "Encerrado", icon: XCircle, cls: "text-muted-foreground" },
  evento_proximo: { label: "Evento próximo", icon: CalendarClock, cls: "text-warn" },
};

function AlertasPage() {
  const qc = useQueryClient();
  const agora = useAgora();
  const q = useQuery({
    queryKey: ["alertas", "feed"],
    queryFn: async () => {
      const { data, error } = await supabase.from("alertas").select("*, sinais(ticker, estrategia)").order("criado_em", { ascending: false }).limit(200);
      if (error) throw error;
      return data;
    },
  });
  const marcar = useMutation({
    mutationFn: async (ids: number[]) => {
      const { error } = await supabase.from("alertas").update({ lido: true }).in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alertas"] }),
  });
  const naoLidos = (q.data ?? []).filter((a) => !a.lido).map((a) => a.id);

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Alertas</h1>
        <Button variant="outline" size="sm" disabled={!naoLidos.length || marcar.isPending} onClick={() => marcar.mutate(naoLidos)}>
          <CheckCheck className="h-4 w-4" /> Marcar todos como lidos
        </Button>
      </div>
      {q.isLoading ? <div className="h-40 rounded-lg border bg-card animate-pulse" /> : !q.data?.length ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">Nenhum alerta ainda.</div>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {q.data.map((a) => {
            const t = TIPOS[a.tipo] ?? { label: a.tipo, icon: Bell, cls: "" };
            return (
              <li key={a.id} className={`flex items-start gap-3 p-4 ${a.lido ? "opacity-60" : ""}`}>
                <t.icon className={`mt-0.5 h-5 w-5 shrink-0 ${t.cls}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className={`font-semibold uppercase tracking-wider ${t.cls}`}>{t.label}</span>
                    <span title={fmtDateTime(a.criado_em)}>{haQuanto(a.criado_em, agora)}</span>
                    {!a.lido && <span className="h-2 w-2 rounded-full bg-primary" />}
                  </div>
                  <p className="mt-1 text-sm">{a.mensagem}</p>
                  {a.sinal_id && <Link to="/sinal/$id" params={{ id: String(a.sinal_id) }} className="mt-1 inline-block text-xs text-primary hover:underline">Ver sinal{a.sinais && ` ${a.sinais.ticker}`} →</Link>}
                </div>
                {!a.lido && <Button variant="ghost" size="sm" onClick={() => marcar.mutate([a.id])}>Marcar lido</Button>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
