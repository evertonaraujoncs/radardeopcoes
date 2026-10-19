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
- Yahoo news ingestion requires explicit related-ticker attribution and provider publication dates; unavailable calendars remain coverage failures, not invented dates or an assertion that no events exist.

- Motor de sinais portado de motor_sinais.py para src/lib/signal-engine.ts (lógica pura, testada em signal-engine.test.ts); a orquestração roda em rodarMotor dentro de src/lib/market.functions.ts, acionada ao fim de cada coleta, usando a grade mais recente por opção na janela de 4 dias e CDI do BCB com fallback de 15% estimado.
