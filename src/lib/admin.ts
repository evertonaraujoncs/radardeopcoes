import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/** Barra qualquer usuário que não esteja em public.admin_users. Use no início de toda função que escreve dados compartilhados. */
export async function exigirAdmin(supabase: SupabaseClient<Database>) {
  const { data, error } = await supabase.rpc("is_admin");
  if (error) throw new Error("Não foi possível verificar a permissão de administrador.");
  if (data !== true) throw new Error("Apenas o administrador pode coletar dados de mercado.");
}
