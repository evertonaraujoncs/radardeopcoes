import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Gauge } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>) => ({ redirect: typeof s["redirect"] === "string" ? (s["redirect"] as string) : undefined }),
  head: () => ({
    meta: [
      { title: "Entrar — Radar de Opções B3" },
      { name: "description", content: "Acesse o Radar de Opções B3 para ver sinais de opções em tempo real." },
      { property: "og:title", content: "Entrar — Radar de Opções B3" },
      { property: "og:description", content: "Acesse o Radar de Opções B3 para ver sinais de opções em tempo real." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { redirect } = Route.useSearch();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [carregando, setCarregando] = useState(false);
  const destino = redirect && redirect.startsWith("/") && !redirect.startsWith("//") ? redirect : "/radar";

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setCarregando(true);
    try {
      // Cadastro fechado: só existe login. Contas novas são criadas pelo administrador no backend.
      const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
      if (error) throw error;
      navigate({ to: destino });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro";
      toast.error(msg.includes("Invalid login") ? "E-mail ou senha incorretos." : msg);
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border bg-card p-8 glow">
        <div className="flex items-center gap-2 mb-1">
          <Gauge className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-semibold">Radar de Opções <span className="text-primary">B3</span></h1>
        </div>
        <p className="text-sm text-muted-foreground mb-6">
          Acesso restrito. Entre para ver os sinais.
        </p>
        <form onSubmit={enviar} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="senha">Senha</Label>
            <Input id="senha" type="password" required minLength={6} value={senha} onChange={(e) => setSenha(e.target.value)} />
          </div>
          <Button type="submit" className="w-full" disabled={carregando}>
            {carregando ? "Aguarde…" : "Entrar"}
          </Button>
        </form>
      </div>
    </div>
  );
}
