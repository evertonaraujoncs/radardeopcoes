import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ESTRATEGIAS } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/parametros")({
  head: () => ({
    meta: [
      { title: "Parâmetros — Radar de Opções B3" },
      { name: "description", content: "Capital, risco máximo, estratégias ativas e filtros mínimos." },
      { property: "og:title", content: "Parâmetros — Radar de Opções B3" },
      { property: "og:description", content: "Capital, risco máximo, estratégias ativas e filtros mínimos." },
    ],
  }),
  component: ParametrosPage,
});

const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(/\./g, "").replace(",", ".")));
const str = (v: number | null | undefined) => (v == null ? "" : String(v).replace(".", ","));

function ParametrosPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["parametros"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const { data, error } = await supabase.from("parametros").select("*").eq("user_id", u.user!.id).maybeSingle();
      if (error) throw error;
      return { userId: u.user!.id, p: data };
    },
  });
  const [v, setV] = useState({ capital: "", risco: "2", liq: "10", spread: "15", prob: "50" });
  const [est, setEst] = useState<string[]>(Object.keys(ESTRATEGIAS));
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    const p = q.data?.p; if (!p) return;
    setV({ capital: str(p.capital), risco: str(p.risco_max_pct), liq: String(p.liquidez_min_negocios), spread: str(p.spread_max_pct), prob: str(Math.round(Number(p.prob_lucro_min) * 100)) });
    if (Array.isArray(p.estrategias_ativas)) setEst(p.estrategias_ativas as string[]);
  }, [q.data]);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!q.data) return;
    setSalvando(true);
    const { error } = await supabase.from("parametros").upsert({
      user_id: q.data.userId, capital: num(v.capital), risco_max_pct: num(v.risco) ?? 2,
      liquidez_min_negocios: Math.round(num(v.liq) ?? 10), spread_max_pct: num(v.spread) ?? 15,
      prob_lucro_min: (num(v.prob) ?? 50) / 100, estrategias_ativas: est, updated_at: new Date().toISOString(),
    });
    setSalvando(false);
    if (error) { toast.error("Não foi possível salvar: " + error.message); return; }
    toast.success("Parâmetros salvos. O robô usa estes valores na próxima execução.");
    qc.invalidateQueries({ queryKey: ["parametros"] });
  }

  const campo = (k: keyof typeof v, label: string, hint?: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={k}>{label}</Label>
      <Input id={k} inputMode="decimal" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} className="num" />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );

  return (
    <form onSubmit={salvar} className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Parâmetros</h1>
      <section className="rounded-lg border bg-card p-5 grid gap-4 sm:grid-cols-2">
        {campo("capital", "Capital (R$)", "Usado para limitar o risco por operação")}
        {campo("risco", "Risco máximo por operação (%)")}
        {campo("liq", "Liquidez mínima (negócios)")}
        {campo("spread", "Spread máximo (%)")}
        {campo("prob", "Probabilidade de lucro mínima (%)")}
      </section>
      <section className="rounded-lg border bg-card p-5">
        <h2 className="mb-3 text-sm font-semibold">Estratégias ativas</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {Object.entries(ESTRATEGIAS).map(([k, nome]) => (
            <label key={k} className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={est.includes(k)} onCheckedChange={(c) => setEst(c ? [...est, k] : est.filter((x) => x !== k))} />
              {nome}
            </label>
          ))}
        </div>
      </section>
      <Button type="submit" disabled={salvando || q.isLoading}>{salvando ? "Salvando…" : "Salvar parâmetros"}</Button>
    </form>
  );
}
