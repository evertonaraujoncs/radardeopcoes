import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Download, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { collectionTargets, collectMarket } from "@/lib/market.functions";

export function ColetarDados() {
  const targets = useServerFn(collectionTargets);
  const collect = useServerFn(collectMarket);
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [results, setResults] = useState<string[]>([]);
  async function start() {
    setRunning(true); setResults([]);
    try {
      const tickers = await targets();
      if (!tickers.length) { setResults(["Nenhum ativo cadastrado para coleta."]); return; }
      for (let i = 0; i < tickers.length; i++) {
        const ticker = tickers[i];
        setProgress(`${ticker} · ${i + 1}/${tickers.length}`);
        try {
          const result = await collect({ data: { ticker } });
          setResults(previous => [...previous, `${ticker}: ${result.historyCount} pregões e ${result.optionsCount} novas cotações de opções.${result.warnings.length ? ` ${result.warnings.join("; ")}` : ""}`]);
        } catch (error) { setResults(previous => [...previous, `${ticker}: ${error instanceof Error ? error.message : "Não foi possível coletar."}`]); }
      }
      await qc.invalidateQueries();
    } catch (error) { setResults([error instanceof Error ? error.message : "Não foi possível iniciar a coleta."]); }
    finally { setRunning(false); setProgress(""); }
  }
  return <div className="flex flex-col items-end gap-2 max-w-xl">
    <Button onClick={start} disabled={running}>{running ? <LoaderCircle className="animate-spin" /> : <Download />}{running ? `Coletando ${progress}` : "Coletar dados"}</Button>
    {results.length > 0 && <div role="status" className="space-y-1 text-xs text-muted-foreground text-right">
      {results.map((result, i) => <p key={i}>{result}</p>)}
      <p className="text-warn">Cobertura parcial: notícias e eventos não conectados. IV, gregas e bid/ask indisponíveis. Sinais não recalculados.</p>
    </div>}
  </div>;
}