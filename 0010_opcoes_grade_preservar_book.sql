-- O COTAHIST grava bid/ask do fechamento; a coleta do opcoes.net.br (sem book) roda no mesmo dia e sobrescreveria com nulos.
-- Este gatilho mantém o bid/ask existente quando a nova linha vem sem book.
CREATE OR REPLACE FUNCTION public.opcoes_grade_preservar_book()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.bid IS NULL AND NEW.ask IS NULL THEN
    NEW.bid := OLD.bid;
    NEW.ask := OLD.ask;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS opcoes_grade_preservar_book ON public.opcoes_grade;
CREATE TRIGGER opcoes_grade_preservar_book
  BEFORE UPDATE ON public.opcoes_grade
  FOR EACH ROW EXECUTE FUNCTION public.opcoes_grade_preservar_book();
