import { describe, expect, it, vi } from "vitest";
import { apagarSinaisInvalidos } from "./signal-maintenance";

describe("limpeza de sinais sem validade", () => {
  it("apaga apenas sinais ativos ausentes da nova geração", async () => {
    const select = vi.fn().mockResolvedValue({ data: [{ id: 9 }], error: null });
    const inChaves = vi.fn().mockReturnValue({ select });
    const eq = vi.fn().mockReturnValue({ in: inChaves });
    const del = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ delete: del });
    await expect(apagarSinaisInvalidos({ from }, ["antiga"])).resolves.toBe(1);
    expect(from).toHaveBeenCalledWith("sinais");
    expect(del).toHaveBeenCalledOnce();
    expect(eq).toHaveBeenCalledWith("status", "ativo");
    expect(inChaves).toHaveBeenCalledWith("chave", ["antiga"]);
  });

  it("não executa exclusão quando todos os sinais continuam válidos", async () => {
    const from = vi.fn();
    await expect(apagarSinaisInvalidos({ from }, [])).resolves.toBe(0);
    expect(from).not.toHaveBeenCalled();
  });
});
