DROP POLICY IF EXISTS "marcar alerta lido" ON public.alertas;
CREATE POLICY "marcar alerta lido" ON public.alertas FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());