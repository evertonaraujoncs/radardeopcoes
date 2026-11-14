import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { LoaderCircle, LogIn } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { entrarNaCarteira } from "@/lib/carteira.functions";

export function EntrarCarteiraButton({ sinalId }: { sinalId: number }) {
  const entrar = useServerFn(entrarNaCarteira);
  const navigate = useNavigate();
  const [salvando, setSalvando] = useState(false);

  async function handleClick() {
    setSalvando(true);
    try {
      const result = await entrar({ data: { sinalId } });
      toast.success(result.existente ? "Esta operação já estava na sua carteira." : "Entrada registrada na sua carteira.");
      await navigate({ to: "/carteira" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível entrar na operação.");
    } finally {
      setSalvando(false);
    }
  }

  return <Button type="button" className="w-full" onClick={handleClick} disabled={salvando} aria-label="Entrar e abrir a carteira">
    {salvando ? <LoaderCircle className="animate-spin" /> : <LogIn />}{salvando ? "Registrando…" : "Entrar"}
  </Button>;
}
