DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['alertas','ativos','dividendos','eventos','fundamentos','noticias','opcoes_grade','scraper_status','sinais','sinais_historico'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "leitura autenticada" ON public.%I', t);
    EXECUTE format('CREATE POLICY "leitura autenticada" ON public.%I FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL)', t);
  END LOOP;
END $$;
DROP POLICY IF EXISTS "marcar alerta lido" ON public.alertas;
CREATE POLICY "marcar alerta lido" ON public.alertas FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
REVOKE UPDATE ON public.alertas FROM authenticated;
GRANT UPDATE (lido) ON public.alertas TO authenticated;