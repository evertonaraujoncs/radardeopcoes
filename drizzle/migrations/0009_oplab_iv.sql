-- IV Rank/Percentil de 1 ano entregues pela OpLab (0 a 1). Preenchidos pela coleta quando OPLAB_ACCESS_TOKEN está configurado.
ALTER TABLE public.ativos
  ADD COLUMN IF NOT EXISTS iv_atual numeric,
  ADD COLUMN IF NOT EXISTS iv_rank_1y numeric,
  ADD COLUMN IF NOT EXISTS iv_percentil_1y numeric,
  ADD COLUMN IF NOT EXISTS iv_atualizado_em timestamptz;