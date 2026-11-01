# Método do Radar de Opções

Regras baseadas no "Manual Definitivo das Opções" (Nobre Investidor). É uma metodologia de referência, não garantia de resultado, e este documento não é recomendação de investimento. As constantes ficam em `src/lib/metodo.ts`; a aplicação, em `src/lib/signal-engine.ts`; a leitura técnica, em `src/lib/tecnica.ts`.

## O que o motor aplica

| Regra | Onde |
|---|---|
| Só ativos líquidos (`UNIVERSO_LIQUIDO`) | `gerarSinais` |
| Só vencimentos mensais (3ª sexta) | `prepararOpcoes` |
| Comprar opção só com IV Rank < 25 e Percentil < 30; vender só com Rank > 50 e Percentil > 80; no meio não opera | `gateVolatilidade` em `avaliar` |
| Travas e condor de débito: custo máximo de 1/4 da distância dos strikes (retorno/risco ≥ 3). Nunca trava de crédito | `avaliar` |
| Venda de put/lançamento coberto: 25 a 45 dias úteis, strike OTM/ATM, garantia em caixa/ativo | `gerarEstruturas`, `avaliar` |
| Collar: custo zero ou crédito, preço médio total abaixo do strike da put | `avaliar` |
| Condor de calls com strikes igualmente espaçados, só em ativo lateral | `gerarEstruturas` |
| Direção tem de bater com a tendência do ativo (MM 20/50/200, IFR 14, estocástico); indefinida não opera | `analisarTecnica`, `TENDENCIA_PERMITIDA` |
| Risco de débito ≤ 1,5% do capital; garantia ≤ capital | `avaliar` |
| Plano da operação: stop e alvo no ATIVO, realizar ~70%, desmontar até a quarta do vencimento, nunca exercer | `montarPlano` |

**IV Rank sem histórico:** enquanto o banco não tem 60+ pregões de IV das opções, o motor usa HV Rank/Percentil (volatilidade de 21 pregões do ativo, comparada com o último ano, de `src/lib/hv.ts`) como substituto. Os sinais ficam com o aviso "IV Rank estimado pela volatilidade histórica" e passam para o IV real sozinhos quando o histórico completar.

Sem IV Rank/Percentil (nem real, nem por HV), sem leitura técnica ou sem bid/ask, o sinal vira **pré-sinal**: score limitado a 59, selo "não validado" e nenhum alerta (`SCORE_PRE_VALIDACAO`).

## Pesos do score
Retorno/risco 25, leitura técnica 20, probabilidade de lucro 15, IV Rank 15, liquidez 10, notícias e eventos 10, valuation 5. O método dá mais peso à assimetria do que à taxa de acerto: a probabilidade do modelo é neutra à direção e não enxerga a vantagem técnica, por isso o piso de probabilidade das travas de débito é só de sanidade (`POP_MIN_DEBITO`).

## Ainda não implementado
- THL (trava horizontal de linha), capital garantido sintético, fence e seagull alavancados: precisam de dois vencimentos ou de vencimentos longos e de avaliação pelo modelo, não só pelo payoff no vencimento.
- Manejos e rolagem de posições já abertas: o motor só gera entradas; não acompanha a carteira.
- Bid/ask real: enquanto a fonte for o fechamento, todo sinal sem book fica como pré-sinal.
- Agentes de IA (notícias, fundamentos, crítico de risco, orquestrador).
