ALTER TABLE public.ativos ADD COLUMN IF NOT EXISTS historico_precos jsonb, ADD COLUMN IF NOT EXISTS fonte_preco text;
COMMENT ON COLUMN public.ativos.historico_precos IS 'Daily OHLCV from Yahoo Finance with original market timestamps; limited to the queried period.';
COMMENT ON COLUMN public.ativos.fonte_preco IS 'Source URL for collected market prices.';