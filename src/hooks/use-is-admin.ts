import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** true só para contas em public.admin_users. A trava real está no servidor (exigirAdmin); isto só esconde o botão. */
export function useIsAdmin() {
  return useQuery({
    queryKey: ["is_admin"],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("is_admin");
      if (error) throw error;
      return data === true;
    },
  });
}
