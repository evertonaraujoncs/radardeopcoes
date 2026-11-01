-- Método (Manual Definitivo das Opções): plano de saída por sinal e novos padrões de parâmetros.
ALTER TABLE public.sinais ADD COLUMN IF NOT EXISTS plano jsonb;
COMMENT ON COLUMN public.sinais.plano IS 'Plano da operação: tese, sinais técnicos, stop/alvo no ativo, realização de lucro, data para desmontar e as cinco perguntas do método.';

-- Estratégias do método (sem trava de crédito). Quem já tinha parâmetros salvos passa a usar o conjunto do método.
ALTER TABLE public.parametros ALTER COLUMN estrategias_ativas SET DEFAULT '["venda_put","lancamento_coberto","collar","collar_baixa","trava_alta_call","trava_baixa_put","condor_call"]'::jsonb;
UPDATE public.parametros
   SET estrategias_ativas = '["venda_put","lancamento_coberto","collar","collar_baixa","trava_alta_call","trava_baixa_put","condor_call"]'::jsonb,
       risco_max_pct = LEAST(risco_max_pct, 1.5);
ALTER TABLE public.parametros ALTER COLUMN risco_max_pct SET DEFAULT 1.5;
