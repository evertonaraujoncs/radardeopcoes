-- 1) Administradores: só quem estiver aqui pode disparar coleta de dados.
CREATE TABLE IF NOT EXISTS public.admin_users (
  user_id uuid PRIMARY KEY,
  criado_em timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.admin_users TO service_role;
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY; -- sem policies: ninguém lê direto, só via is_admin()

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid());
$$;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

-- Cadastra o admin pelo e-mail. Rode UMA vez no SQL Editor:
--   select public.tornar_admin('seu@email.com');
CREATE OR REPLACE FUNCTION public.tornar_admin(p_email text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE uid uuid;
BEGIN
  SELECT id INTO uid FROM auth.users WHERE lower(email) = lower(p_email);
  IF uid IS NULL THEN RAISE EXCEPTION 'Usuário % não encontrado. Crie/entre com essa conta antes.', p_email; END IF;
  INSERT INTO public.admin_users(user_id) VALUES (uid) ON CONFLICT DO NOTHING;
  RETURN uid;
END $$;
REVOKE ALL ON FUNCTION public.tornar_admin(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tornar_admin(text) TO service_role;

-- 2) Ingestão idempotente.
-- 2a) Uma cotação por opção por dia (remove duplicadas antigas, mantendo a mais recente).
DELETE FROM public.opcoes_grade a USING public.opcoes_grade b
 WHERE a.ticker = b.ticker AND a.data_coleta = b.data_coleta AND a.id < b.id;
CREATE UNIQUE INDEX IF NOT EXISTS opcoes_grade_ticker_dia_uniq ON public.opcoes_grade (ticker, data_coleta);

-- 2b) Lotes já processados (cabeçalho Idempotency-Key do robô).
CREATE TABLE IF NOT EXISTS public.ingest_lotes (
  id text PRIMARY KEY,
  recebido_em timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.ingest_lotes TO service_role;
ALTER TABLE public.ingest_lotes ENABLE ROW LEVEL SECURITY;

-- 3) Resultado no vencimento.
ALTER TABLE public.sinais
  ADD COLUMN IF NOT EXISTS encerrado_em timestamptz,
  ADD COLUMN IF NOT EXISTS motivo_encerramento text,
  ADD COLUMN IF NOT EXISTS preco_vencimento numeric,
  ADD COLUMN IF NOT EXISTS resultado numeric;
ALTER TABLE public.sinais DROP CONSTRAINT IF EXISTS sinais_motivo_encerramento_check;
ALTER TABLE public.sinais ADD CONSTRAINT sinais_motivo_encerramento_check
  CHECK (motivo_encerramento IS NULL OR motivo_encerramento IN ('vencimento','deixou_de_valer'));
COMMENT ON COLUMN public.sinais.resultado IS 'Resultado em R$ do sinal no vencimento (lote de 100), calculado com o fechamento do ativo na data do vencimento; null enquanto aberto ou se encerrado antes.';
CREATE INDEX IF NOT EXISTS sinais_encerrados_idx ON public.sinais (vencimento DESC) WHERE status = 'encerrado';
