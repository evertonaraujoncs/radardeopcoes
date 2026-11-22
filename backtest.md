# Backtest do motor com o COTAHIST

`scripts/backtest-cotahist.ts` roda o motor de sinais dia a dia sobre opções históricas da B3 (COTAHIST, gratuito), sem olhar o futuro, e mede o que aconteceu com cada sinal.

## Como usar
```
bun scripts/backtest-cotahist.ts --baixar-anos 2024,2025 --ativos PETR4,VALE3 --de 2025-03-01
bun scripts/backtest-cotahist.ts COTAHIST_A2024.ZIP COTAHIST_A2025.ZIP --alvo 0.7 --stop 0.5 --custo 5
```
Opções: `--ativos`, `--de`, `--ate`, `--passo N` (gera sinais a cada N pregões; use 5 para acelerar), `--alvo` (% do lucro máximo), `--stop` (% da perda máxima), `--custo` (R$ por perna e por operação), `--max-abertas` (por ativo), `--cdi`, `--saida`.
Se o download automático falhar, baixe os arquivos anuais em https://www.b3.com.br/pt_br/market-data-e-indices/servicos-de-dados/market-data/historico/mercado-a-vista/cotacoes-historicas/ e passe os caminhos.

## O que ele mede
- **Gerenciado:** sai no alvo, no stop ou 2 dias antes do vencimento (como o método manda).
- **Mantido até o vencimento:** o que a liquidação do Radar mede hoje.
- **Calibração:** probabilidade prevista contra a taxa de acerto real, por faixa, e o índice de Brier (menor é melhor).
- **Score:** correlação de Spearman entre o score e o resultado. Perto de zero significa que o score não ordena os resultados.
- Por estratégia: acerto, média, soma, payoff (ganho médio / perda média) e pior sequência. Os trades vão para `backtest-trades.csv`.

Entradas e saídas usam o lado desfavorável do book (compra no ask, venda no bid); sem book, o último negócio.

## Limites (leia antes de confiar nos números)
- **Precisa de ~12 meses de histórico antes de `--de`** para o IV Rank; sem ele, os fatores de IV ficam neutros e o script avisa.
- Notícias, valuation, proventos e análise técnica não existem no histórico e ficam neutros. Mede a lógica de preços e estruturas, não o motor completo.
- Dados de fim de dia; o primeiro dia de uma posição entra pelo fechamento, sem atraso de execução.
- **Poucos casos enganam:** com menos de 30 operações por estratégia ou faixa, as médias não são confiáveis. Um período curto de alta ou de baixa domina o resultado.
- Stop percentual sobre a perda máxima pode ser apertado demais para estruturas de risco já limitado (collar, travas); compare sempre o gerenciado com o mantido até o vencimento.
- Não é recomendação de investimento; resultado passado não garante resultado futuro.

## Alinhamento de datas no motor
Desde esta versão o motor só usa opções negociadas no pregão de referência (o mais recente) e o fechamento do ativo nesse mesmo pregão (`src/lib/alinhamento.ts`). Grades com mais de 3 pregões de defasagem não geram sinais; com mais de 1, o sinal ganha o aviso "Cotações com mais de 1 pregão de defasagem".
