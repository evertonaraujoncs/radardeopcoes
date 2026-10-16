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
