/** Exclui somente sinais ativos reprovados por uma coleta validada; o histórico de vencidos permanece. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function apagarSinaisInvalidos(db: any, chaves: string[]) {
  if (!chaves.length) return 0;
  const { data, error } = await db.from("sinais").delete().eq("status", "ativo").in("chave", chaves).select("id");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}
