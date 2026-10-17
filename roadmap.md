## Correções do detalhe do sinal
- [x] Normalizar as pernas recebidas e apresentar compra/venda, quantidade, strike e prêmio com clareza.
- [x] Restaurar a curva completa do payoff e verificar seus valores.
- [x] Diferenciar carregamento, erro e ausência de dados em eventos, notícias e histórico.
- [x] Verificar o sinal autenticado e esclarecer a cobertura real dos dados de mercado: tabelas vazias, nenhuma coleta histórica ampla comprovada.

## Coleta manual
- [x] Conectar coleta real de fontes públicas dentro do app e adicionar botão no Radar (Yahoo Finance e opcoes.net.br).
- [x] Verificar coleta autenticada, persistência e limitações de cobertura.
- [x] Selecionar ticker com opções na B3 ou Todos e persistir a coleta correspondente; teste autenticado de VALE3 salvou 247 pregões e 200 opções, e Todos foi validado por teste de seleção.
- [x] Verificar dados necessários para IV, gregas, bid/ask e recálculo; fonte pública não fornece ofertas e motor Python permanece externo.
- [ ] Notícias e eventos completos: tentativas Yahoo integradas, mas notícias retornam vazias e calendário retorna HTTP 401; endereço móvel indicado retorna 404. Bloqueio: fonte Yahoo acessível com cobertura por ticker.
- [ ] Recomendações finais: bloqueio de cotações bid/ask reais e integração do motor externo; não recalcular scores usando dados incompletos ou antigos.