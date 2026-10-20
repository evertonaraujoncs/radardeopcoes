import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { collectionTargets, collectMarket } from "@/lib/market.functions";
import { selectedTargets } from "@/lib/market-data";

export function ColetarDados() {
  const targets = useServerFn(collectionTargets);
  const collect = useServerFn(collectMarket);
  const qc = useQueryClient();
  const catalog = useQuery({ queryKey: ["collection-targets"], queryFn: () => targets(), staleTime: 30 * 60 * 1000 });
  const [selected, setSelected] = useState("all");
  const [running, setRunning] = useState(false);
  const stop = useRef(false);
  const [progress, setProgress] = useState("");
  const [results, setResults] = useState<string[]>([]);
  async function waitUntil(until: string | undefined, ticker: string) {
    const end = until ? Date.parse(until) : Date.now();
    while (!stop.current && Date.now() < end) {
      setProgress(`${ticker} · aguardando ${Math.ceil((end - Date.now()) / 1000)}s`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    return !stop.current;
  }
  async function start() {
    stop.current = false;
    setRunning(true); setResults([]);
    try {
      const available = catalog.data ?? await targets();
      const tickers = selectedTargets(available, selected);
      if (!tickers.length) { setResults(["Nenhum ativo cadastrado para coleta."]); return; }
      for (let i = 0; i < tickers.length; i++) {
        if (stop.current) { setResults(previous => [...previous, "Coleta interrompida; dados já salvos foram preservados."]); break; }
        const ticker = tickers[i];
        setProgress(`${ticker} · ${i + 1}/${tickers.length}`);
        try {
          if (!ticker) continue;
          let optionsOnly = false;
          while (!stop.current) {
            const result = await collect({ data: { ticker, optionsOnly } });
            if (result.schedule.kind === "recent") {
              setResults(previous => [...previous, `${ticker}: coleta de opções já concluída nas últimas 4 horas; dados preservados.`]);
              break;
            }
            if (result.schedule.kind === "wait") {
              if (result.circuit) {
                setResults(previous => [...previous, `Coleta interrompida por bloqueios da fonte. Disponível após ${result.nextAt ? new Date(result.nextAt).toLocaleString("pt-BR") : "a pausa"}; dados salvos preservados.`]);
                stop.current = true;
                break;
              }
              if (!(await waitUntil(result.nextAt, ticker))) break;
              continue;
            }
            setResults(previous => [...previous, `${ticker}: ${result.historyCount} pregões, ${result.optionsCount} opções, ${result.newsCount} notícias e ${result.eventsCount} eventos salvos, ${result.signalsCount} sinais calculados.${result.warnings.length ? ` ${result.warnings.join("; ")}` : ""}`]);
            await qc.invalidateQueries();
            if (result.circuit) {
              setResults(previous => [...previous, `Coleta interrompida após bloqueios consecutivos. Tente após ${result.nextAt ? new Date(result.nextAt).toLocaleString("pt-BR") : "a pausa"}.`]);
              stop.current = true;
              break;
            }
            if (!result.retry) break;
            optionsOnly = true;
            if (!(await waitUntil(result.nextAt, ticker))) break;
          }
        } catch (error) { setResults(previous => [...previous, `${ticker}: ${error instanceof Error ? error.message : "Não foi possível coletar."}`]); }
      }
      await qc.invalidateQueries();
    } catch (error) { setResults([error instanceof Error ? error.message : "Não foi possível iniciar a coleta."]); }
    finally { setRunning(false); setProgress(""); }
  }
  return <div className="flex w-full flex-col items-end gap-2 sm:w-auto sm:max-w-xl">
    <div className="flex w-full items-center gap-2 sm:w-auto">
      <Select value={selected} onValueChange={setSelected} disabled={running || catalog.isPending || catalog.isError}>
        <SelectTrigger aria-label="Ativo para coleta" className="w-36 shrink-0 bg-background"><SelectValue placeholder="Ativo" /></SelectTrigger>
        <SelectContent className="max-h-80"><SelectItem value="all">Todos</SelectItem>{catalog.data?.map(ticker => <SelectItem key={ticker} value={ticker}>{ticker}</SelectItem>)}</SelectContent>
      </Select>
      <Button onClick={start} disabled={running || catalog.isPending || catalog.isError} className="min-w-0 flex-1">{running ? <LoaderCircle className="animate-spin" /> : <Download />}{running ? "Coletando…" : "Coletar dados"}</Button>
    </div>
    {catalog.isError && <p role="alert" className="text-xs text-loss">Não foi possível carregar os ativos. <Button variant="link" size="sm" onClick={() => catalog.refetch()}>Tentar novamente</Button></p>}
    {running && <div className="flex items-center gap-2"><p role="status" className="text-xs text-muted-foreground">{progress}</p><Button variant="ghost" size="sm" onClick={() => { stop.current = true; }}>Interromper</Button></div>}
    {results.length > 0 && <div role="status" className="max-h-64 w-full space-y-1 overflow-y-auto text-xs text-muted-foreground text-right">
      {results.map((result, i) => <p key={i}>{result}</p>)}
    </div>}
  </div>;
}