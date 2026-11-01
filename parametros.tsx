import { IV_COMPRA, IV_VENDA, JANELA_VENDA_DU, MIN_DIAS_IV, UNIVERSO_LIQUIDO } from "@/lib/metodo";
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
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
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
  const [v, setV] = useState({ capital: "", risco: "1,5", liq: "10", spread: "15", prob: "50" });
  const [est, setEst] = useState<string[]>(Object.keys(ESTRATEGIAS).filter((k) => k !== "compra_call"));
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
      user_id: q.data.userId, capital: num(v.capital), risco_max_pct: num(v.risco) ?? 1.5,
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
        {campo("capital", "Capital (R$)", "Limita o risco das operações de débito e confere a garantia de venda de put, lançamento coberto e collar")}
        {campo("risco", "Risco máximo por operação de débito (%)", "O método usa 1% a 1,5% do patrimônio")}
        {campo("liq", "Liquidez mínima (negócios)")}
        {campo("spread", "Spread máximo (%)")}
        {campo("prob", "Probabilidade mínima na venda de prêmio (%)", "Só vale para venda de put e lançamento coberto; travas de débito são avaliadas pelo retorno/risco")}
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
      <section className="rounded-lg border bg-card p-5 text-sm space-y-2" aria-label="Regras fixas do método">
        <h2 className="text-sm font-semibold">Regras fixas do método</h2>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>Só ativos líquidos: {UNIVERSO_LIQUIDO.join(", ")}.</li>
          <li>Comprar opção só com IV Rank abaixo de {IV_COMPRA.rank * 100} e IV Percentil abaixo de {IV_COMPRA.percentil * 100}; vender só com IV Rank acima de {IV_VENDA.rank * 100} e IV Percentil acima de {IV_VENDA.percentil * 100}. Entre os dois, não opera.</li>
          <li>Travas e condor de débito pagam no máximo 1/4 da distância entre os strikes (retorno/risco de 3 ou mais). Nunca trava de crédito.</li>
          <li>Venda de prêmio com vencimento entre {JANELA_VENDA_DU.min} e {JANELA_VENDA_DU.max} dias úteis; só vencimentos mensais.</li>
          <li>Direção da operação precisa bater com a tendência do ativo (médias 20/50/200, IFR e estocástico); tendência indefinida não opera.</li>
          <li>Sem IV Rank/Percentil ({MIN_DIAS_IV}+ pregões), leitura técnica ou bid/ask, o sinal vira pré-sinal: score limitado e sem alerta.</li>
        </ul>
      </section>
      <Button type="submit" disabled={salvando || q.isLoading}>{salvando ? "Salvando…" : "Salvar parâmetros"}</Button>
    </form>
  );
}
