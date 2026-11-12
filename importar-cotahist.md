# Importador do COTAHIST (B3, gratuito)

Alimenta o Radar com **bid/ask do fechamento, número de negócios, IV e delta** das opções do universo (PETR4, VALE3, BBAS3, ITUB4, BBDC4, SANB11, BOVA11) a partir do arquivo de Cotações Históricas da B3. Dados de fim de dia, para consulta informativa conforme os termos da B3.

## Como funciona
1. Lê o arquivo (`.ZIP` ou `.TXT`) em streaming, sem carregar tudo em memória.
2. Pega o fechamento de cada ativo no dia e as opções de vencimento mensal entre 15 e 60 dias, com strike até 15% do preço.
3. Calcula IV e delta (Black-Scholes) com o preço do book (média de compra e venda) ou, sem book, o último negócio.
4. Envia para `/api/public/ingest` (`opcoes_grade`), que faz upsert por opção e dia. Rodar de novo não duplica.
5. A migration `0010` impede que a coleta do opcoes.net.br apague o bid/ask que o COTAHIST gravou no mesmo dia.

## Configuração (uma vez)
- GitHub: Settings → Secrets and variables → Actions → **Secrets** → `INGEST_KEY` (o mesmo valor do segredo `INGEST_KEY` do app).
- Opcional, em **Variables**: `RADAR_URL` (padrão `https://radardeopcoes.lovable.app`).
- Rode a migration `0010_opcoes_grade_preservar_book.sql` no SQL Editor.

## Histórico de IV (uma vez)
Actions → **COTAHIST diário (B3)** → **Run workflow** com `meses = 12`. Isso baixa os 12 arquivos mensais e monta o histórico para o IV Rank. Depois o agendamento (dias úteis, 19:30 de Brasília) mantém o diário.

## Uso local
```
bun scripts/importar-cotahist.ts COTAHIST_D12112026.ZIP     # arquivo baixado à mão
bun scripts/importar-cotahist.ts --baixar-ultimo
bun scripts/importar-cotahist.ts --baixar-meses 12
bun scripts/importar-cotahist.ts --dry-run <arquivo>        # confere sem enviar
```
Variáveis: `INGEST_KEY`, `RADAR_URL`, `CDI_ANUAL` (se ausente, busca no Banco Central; reserva 14%).

## Se o download automático falhar
O servidor da B3 pode bloquear o endereço do GitHub ou ter mudado o caminho (`B3_COTAHIST_BASE`). Baixe o arquivo em
https://www.b3.com.br/pt_br/market-data-e-indices/servicos-de-dados/market-data/historico/mercado-a-vista/cotacoes-historicas/
e rode o script no seu computador com o caminho do arquivo.

## Limites
- Fim de dia: o Radar não reage ao movimento durante o pregão.
- As ofertas de fechamento podem estar afastadas do preço justo; o motor continua sinalizando spread largo.
- O layout de largura fixa foi implementado conforme o documento oficial e testado com arquivos sintéticos; confira o primeiro arquivo real com `--dry-run`.
