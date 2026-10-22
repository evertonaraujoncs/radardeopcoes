<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Normalize signal legs through `src/lib/payoff.ts` before display or local payoff calculations; ingestion may contain numeric sides or Portuguese buy/sell strings and lowercase option types.
- Treat empty market-data queries as missing coverage, not proof that news or events do not exist; render loading and query failures separately.
- Payoff calculations and labels use lots of 100 units, with contract premiums displayed per unit, to keep chart and structure units consistent.
- Manual market collection is available to authenticated users only for registered, readable tickers; server-owned fetching controls all shared writes, never accepting submitted prices or arbitrary URLs.
- Collection preserves provider quote timestamps and reports partial coverage; stored price snapshots must never refresh signal scores or imply recalculation of the external engine.
- Discover the options universe from the provider sitemap and register server-owned ticker rows before exposing authenticated readable collection targets; this prevents a guessed ticker catalog and client-submitted market writes.
- Rank the top-20 collection group server-side by provider closing price times traded quantity across the complete quote-list response, intersected with readable option tickers; report the estimated financial-volume metric and refuse incomplete rankings rather than use a fixed list.
- Yahoo news ingestion requires explicit related-ticker attribution and provider publication dates; unavailable calendars remain coverage failures, not invented dates or an assertion that no events exist.
- Adapt Python scraper protections to Worker-safe fetch collection: persist atomic provider leases, successful-asset intervals and retry/circuit state in server-owned storage; defer long waits to the calling UI so retries survive requests without server sleeps. Do not execute Python/Chromium or auto-generated adapter code in the app runtime.
- Validate option grids and underlying attribution before writes; failed/blocked option collection must preserve existing signals instead of recalculating or closing them from incomplete coverage.
- Read Opções.net closing chains through its public OptionsChain request and map columns by provider IDs, validating underlying attribution and original timestamps; store provider Greeks separately from engine estimates and leave unavailable offers null.
- Recover stale route chunks at the root boundary and Vite preload event with a session-persisted reload guard; this fetches the current deployment without an automatic reload loop.

- Motor de sinais portado de motor_sinais.py para src/lib/signal-engine.ts (lógica pura, testada em signal-engine.test.ts); a orquestração roda em rodarMotor dentro de src/lib/market.functions.ts, acionada ao fim de cada coleta, usando a grade mais recente por opção na janela de 4 dias e CDI do BCB com fallback de 15% estimado.
