import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Paginação simples (página 0-based). Esconde-se sozinho quando cabe tudo em uma página. */
export function Paginador({ pagina, total, porPagina, onChange, carregando }: {
  pagina: number; total: number; porPagina: number; onChange: (p: number) => void; carregando?: boolean;
}) {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  if (paginas <= 1) return null;
  return (
    <nav aria-label="Paginação" className="flex items-center justify-center gap-3 pt-2">
      <Button variant="outline" size="sm" disabled={pagina <= 0 || carregando} onClick={() => onChange(pagina - 1)}>
        <ChevronLeft className="h-4 w-4" /> Anterior
      </Button>
      <span className="num text-sm text-muted-foreground" aria-live="polite">Página {pagina + 1} de {paginas}</span>
      <Button variant="outline" size="sm" disabled={pagina >= paginas - 1 || carregando} onClick={() => onChange(pagina + 1)}>
        Próxima <ChevronRight className="h-4 w-4" />
      </Button>
    </nav>
  );
}
