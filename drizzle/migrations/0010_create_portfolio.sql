CREATE TABLE public.carteira (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL,
  sinal_id bigint,
  chave text NOT NULL,
  ticker text NOT NULL,
  estrategia text NOT NULL,
  pernas jsonb NOT NULL,
  vencimento date NOT NULL,
  entrada_em timestamptz NOT NULL DEFAULT now(),
  preco_ativo_entrada numeric NOT NULL,
  credito_debito_entrada numeric NOT NULL,
  perda_max_entrada numeric,
  capital_base numeric,
  score_entrada numeric,
  prob_lucro_entrada numeric,
  retorno_risco_entrada numeric,
  preco_ativo_atual numeric,
  pernas_atuais jsonb,
  premio_atual numeric,
  resultado numeric NOT NULL DEFAULT 0,
  retorno_pct numeric,
  score_atual numeric,
  prob_lucro_atual numeric,
  sinal_ativo boolean NOT NULL DEFAULT true,
  preco_estimado boolean NOT NULL DEFAULT false,
  cobertura text NOT NULL DEFAULT 'entrada' CHECK (cobertura IN ('entrada','completa','parcial','vencimento','sem_preco')),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, chave)
);
GRANT SELECT, INSERT, DELETE ON public.carteira TO authenticated;
GRANT ALL ON public.carteira TO service_role;
ALTER TABLE public.carteira ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ler carteira propria" ON public.carteira FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "entrar na carteira propria" ON public.carteira FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "remover da carteira propria" ON public.carteira FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX carteira_user_entrada_idx ON public.carteira (user_id, entrada_em DESC);
CREATE INDEX carteira_ticker_idx ON public.carteira (ticker) WHERE sinal_ativo = true;
COMMENT ON TABLE public.carteira IS 'Operações acompanhadas por cada usuário; valores por lote de 100 e prêmios das pernas por unidade.';
COMMENT ON COLUMN public.carteira.sinal_id IS 'Referência histórica sem chave estrangeira: o snapshot da carteira sobrevive à exclusão do sinal do Radar.';
COMMENT ON COLUMN public.carteira.resultado IS 'Lucro/prejuízo em R$ por lote de 100, sem custos, emolumentos ou dividendos.';
COMMENT ON COLUMN public.carteira.capital_base IS 'Débito de entrada ou perda máxima de entrada, por lote; base do retorno percentual quando disponível.';
COMMENT ON COLUMN public.carteira.preco_estimado IS 'Indica uso de último negócio sem bid/ask na entrada ou na marcação a mercado.';