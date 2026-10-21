## Correções do detalhe do sinal
- [x] Normalizar as pernas recebidas e apresentar compra/venda, quantidade, strike e prêmio com clareza.
- [x] Restaurar a curva completa do payoff e verificar seus valores.
- [x] Diferenciar carregamento, erro e ausência de dados em eventos, notícias e histórico.
- [x] Verificar o sinal autenticado e esclarecer a cobertura real dos dados de mercado: tabelas vazias, nenhuma coleta histórica ampla comprovada.

## Coleta manual
- [ ] Adicionar seleção dos 20 ativos mais líquidos com ranking verificável.
- [ ] Disponibilizar compra de call a seco nos parâmetros e no motor, com testes de risco e payoff.
- [ ] Verificar campos de bid/ask e gregas públicos de opcoes.net.br e integrar somente dados reais acessíveis.
- [x] Adaptar proteções do coletor enviado: pausas compartilhadas, 4 tentativas com Retry-After, intervalo de 4h e disjuntor persistente; validação por ativo/data sem inventar cotações. Coleta autenticada PETR4 salvou 129 opções; repetição foi impedida. Python/Chromium e reparo por IA não executados no app; notícias/eventos continuam bloqueados pela cobertura Yahoo.
- [x] Conectar coleta real de fontes públicas dentro do app e adicionar botão no Radar (Yahoo Finance e opcoes.net.br).
- [x] Verificar coleta autenticada, persistência e limitações de cobertura.
- [x] Selecionar ticker com opções na B3 ou Todos e persistir a coleta correspondente; teste autenticado de VALE3 salvou 247 pregões e 200 opções, e Todos foi validado por teste de seleção.
- [x] Verificar dados necessários para IV, gregas, bid/ask e recálculo; fonte pública não fornece ofertas e motor Python permanece externo.
- [ ] Notícias e eventos completos: tentativas Yahoo integradas, mas notícias retornam vazias e calendário retorna HTTP 401; endereço móvel indicado retorna 404. Bloqueio: fonte Yahoo acessível com cobertura por ticker.
- [x] Integrar o motor de sinais ao app (porte para TypeScript, rodando no servidor após cada coleta, com testes do selftest).
- [ ] Fonte confiável de cotações de opções B3 com bid/ask reais, alimentando IV, gregas e recálculo dos sinais (pedido do usuário; opcoes.net.br gratuito não expõe bid/ask).