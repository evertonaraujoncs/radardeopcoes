import { createFileRoute, Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { corValor, fmtBRL, fmtDate, fmtPct, nomeEstrategia } from "@/lib/format";
import { Paginador } from "@/components/radar/Paginador";

export const Route = createFileRoute("/_authenticated/resultados")({
  head: () => ({
    meta: [
      { title: "Resultados — Radar de Opções B3" },
      { name: "description", content: "Como os sinais terminaram no vencimento, comparado com a probabilidade estimada." },
      { property: "og:title", content: "Resultados — Radar de Opções B3" },
      { property: "og:description", content: "Como os sinais terminaram no vencimento, comparado com a probabilidade estimada." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResultadosPage,
});

const POR_PAGINA = 20;

function ResultadosPage() {
  const [pagina, setPagina] = useState(0);

  const resumo = useQuery({
    queryKey: ["sinais", "resultados", "resumo"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sinais").select("resultado,prob_lucro")
        .eq("status", "encerrado").eq("motivo_encerramento", "vencimento").not("resultado", "is", null).limit(5000);
      if (error) throw error;
      const n = data.length;
      const lucros = data.filter((r) => Number(r.resultado) > 0).length;
      const probs = data.filter((r) => r.prob_lucro != null);
      return {
        n,
        taxaAcerto: n ? lucros / n : null,
        probMedia: probs.length ? probs.reduce((a, r) => a + Number(r.prob_lucro), 0) / probs.length : null,
        soma: data.reduce((a, r) => a + Number(r.resultado), 0),
        media: n ? data.reduce((a, r) => a + Number(r.resultado), 0) / n : null,
      };
    },
  });

  const lista = useQuery({
    queryKey: ["sinais", "resultados", "lista", pagina],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error, count } = await supabase.from("sinais").select("*", { count: "exact" })
        .eq("status", "encerrado").eq("motivo_encerramento", "vencimento")
        .order("vencimento", { ascending: false }).order("id", { ascending: false })
        .range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1);
      if (error) throw error;
      return { linhas: data, total: count ?? data.length };
    },
  });

  const r = resumo.data;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Resultados</h1>
        <p className="text-sm text-muted-foreground">
          Como cada sinal terminaria se mantido até o vencimento, usando o fechamento do ativo na data. Lote de 100, sem custos nem dividendos.
        </p>
      </div>

      <dl className="num grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card l="Sinais liquidados" v={r ? String(r.n) : "—"} />
        <Card l="Terminaram no lucro" v={fmtPct(r?.taxaAcerto)} sub={r?.probMedia != null ? `previsto: ${fmtPct(r.probMedia)}` : undefined} />
        <Card l="Resultado total" v={r ? fmtBRL(r.soma) : "—"} c={corValor(r?.soma)} />
        <Card l="Média por sinal" v={r?.media != null ? fmtBRL(r.media) : "—"} c={corValor(r?.media)} />
      </dl>

      {lista.isLoading ? <div className="h-40 rounded-lg border bg-card animate-pulse" />
        : lista.error ? <p className="text-loss">Erro ao carregar resultados: {(lista.error as Error).message}</p>
        : !lista.data?.linhas.length ? (
          <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
            Nenhum sinal chegou ao vencimento ainda. Os resultados aparecem aqui depois do primeiro vencimento com preço coletado.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr><th className="p-3">Ativo</th><th className="p-3">Estratégia</th><th className="p-3">Vencimento</th>
                  <th className="p-3 text-right">Fechamento</th><th className="p-3 text-right">Prob. prevista</th><th className="p-3 text-right">Resultado</th></tr>
              </thead>
              <tbody className="num">
                {lista.data.linhas.map((s) => (
                  <tr key={s.id} className="border-t">
                    <td className="p-3 font-semibold"><Link to="/sinal/$id" params={{ id: String(s.id) }} className="hover:text-primary">{s.ticker}</Link></td>
                    <td className="p-3 font-sans">{nomeEstrategia(s.estrategia)}</td>
                    <td className="p-3">{fmtDate(s.vencimento)}</td>
                    <td className="p-3 text-right">{s.preco_vencimento != null ? fmtBRL(s.preco_vencimento) : "—"}</td>
                    <td className="p-3 text-right">{fmtPct(s.prob_lucro)}</td>
                    <td className={`p-3 text-right font-semibold ${corValor(s.resultado)}`}>{s.resultado != null ? fmtBRL(s.resultado) : "sem preço"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      <Paginador pagina={pagina} total={lista.data?.total ?? 0} porPagina={POR_PAGINA} onChange={setPagina} carregando={lista.isFetching} />
    </div>
  );
}

function Card({ l, v, sub, c = "" }: { l: string; v: string; sub?: string | undefined; c?: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground font-sans">{l}</dt>
      <dd className={`text-xl font-semibold ${c}`}>{v}</dd>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
