import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Activity, Bell, Flag, Gauge, LogOut, Radar, SlidersHorizontal, TriangleAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { desatualizado, haQuanto } from "@/lib/format";
import { useAgora } from "@/hooks/use-agora";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth", search: { redirect: location.href } });
  },
  component: Layout,
});

export function useUltimoStatus() {
  return useQuery({
    queryKey: ["scraper_status", "ultimo"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scraper_status").select("*").order("executado_em", { ascending: false }).limit(1);
      if (error) throw error;
      return data[0] ?? null;
    },
  });
}

function useAlertasNaoLidos() {
  return useQuery({
    queryKey: ["alertas", "nao-lidos"],
    queryFn: async () => {
      const { count, error } = await supabase.from("alertas").select("id", { count: "exact", head: true }).eq("lido", false);
      if (error) throw error;
      return count ?? 0;
    },
  });
}

const nav = [
  { to: "/radar", label: "Radar", icon: Radar },
  { to: "/alertas", label: "Alertas", icon: Bell },
  { to: "/resultados", label: "Resultados", icon: Flag },
  { to: "/parametros", label: "Parâmetros", icon: SlidersHorizontal },
  { to: "/status", label: "Status do robô", icon: Activity },
] as const;

function Layout() {
  const qc = useQueryClient();
  const agora = useAgora();
  const status = useUltimoStatus();
  const naoLidos = useAlertasNaoLidos();

  useEffect(() => {
    const ch = supabase
      .channel("global")
      .on("postgres_changes", { event: "*", schema: "public", table: "scraper_status" }, () =>
        qc.invalidateQueries({ queryKey: ["scraper_status"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "alertas" }, () =>
        qc.invalidateQueries({ queryKey: ["alertas"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const s = status.data;
  const quebrado = status.isSuccess && (!s || s.status === "QUEBRADO" || desatualizado(s.executado_em, agora));

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 h-14 flex items-center gap-6">
          <Link to="/radar" className="flex items-center gap-2 font-semibold tracking-tight">
            <Gauge className="h-5 w-5 text-primary" />
            <span>Radar de Opções <span className="text-primary">B3</span></span>
          </Link>
          <nav className="flex items-center gap-1 overflow-x-auto">
            {nav.map((n) => (
              <Link key={n.to} to={n.to}
                className="relative flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary"
                activeProps={{ className: "text-foreground bg-secondary" }}>
                <n.icon className="h-4 w-4" />
                <span className="hidden sm:inline">{n.label}</span>
                {n.to === "/alertas" && (naoLidos.data ?? 0) > 0 && (
                  <span className="num ml-1 rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                    {naoLidos.data}
                  </span>
                )}
              </Link>
            ))}
          </nav>
          <button onClick={() => supabase.auth.signOut()}
            className="ml-auto flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Sair</span>
          </button>
        </div>
        {quebrado && (
          <Link to="/status" className="block bg-destructive text-destructive-foreground text-sm">
            <div className="mx-auto max-w-7xl px-4 py-2 flex items-center gap-2">
              <TriangleAlert className="h-4 w-4" />
              {!s ? "O robô ainda não registrou nenhuma coleta."
                : s.status === "QUEBRADO" ? `Robô QUEBRADO na última execução (${haQuanto(s.executado_em, agora)}).`
                : `Sem coleta recente — última ${haQuanto(s.executado_em, agora)}.`}
              <span className="underline ml-auto">Ver status</span>
            </div>
          </Link>
        )}
      </header>
      <main className="flex-1 mx-auto w-full max-w-7xl px-4 py-6"><Outlet /></main>
      <footer className="sticky bottom-0 border-t bg-card/95 backdrop-blur">
        <p className="mx-auto max-w-7xl px-4 py-2 text-xs text-muted-foreground flex items-center gap-2">
          <TriangleAlert className="h-3.5 w-3.5 text-warn shrink-0" />
          A probabilidade de lucro é uma estimativa de modelo, não garantia. Isto não é recomendação de investimento.
        </p>
      </footer>
    </div>
  );
}
