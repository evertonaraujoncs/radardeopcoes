import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fmtDateTime, fmtNum } from "@/lib/format";
import { Tag } from "./Tags";

export function Noticias({ ticker, limite = 10 }: { ticker: string; limite?: number }) {
  const q = useQuery({
    queryKey: ["noticias", ticker, limite],
    queryFn: async () => {
      const { data, error } = await supabase.from("noticias").select("*").eq("ticker", ticker)
        .order("publicado_em", { ascending: false, nullsFirst: false }).limit(limite);
      if (error) throw error;
      return data;
    },
  });
  if (!q.data?.length) return <p className="text-sm text-muted-foreground">Sem notícias.</p>;
  return (
    <ul className="space-y-3">
      {q.data.map((n) => {
        const s = n.sentimento == null ? null : Number(n.sentimento);
        const tone = s == null ? "neutral" : s > 0.15 ? "gain" : s < -0.15 ? "loss" : "neutral";
        return (
          <li key={n.id} className="text-sm">
            <div className="flex items-start gap-2">
              <Tag tone={tone}>{s == null ? "—" : `${s > 0 ? "+" : ""}${fmtNum(s)}`}</Tag>
              {n.url ? <a href={n.url} target="_blank" rel="noreferrer" className="font-medium hover:text-primary">{n.titulo}</a>
                : <span className="font-medium">{n.titulo}</span>}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{n.fonte ?? "—"} · {fmtDateTime(n.publicado_em)}</p>
            {n.resumo && <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{n.resumo}</p>}
          </li>
        );
      })}
    </ul>
  );
}
