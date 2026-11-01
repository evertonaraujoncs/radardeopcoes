/**
 * Regras do método (Manual Definitivo das Opções) em forma de código.
 * Tudo aqui é constante ou função pura; o motor (signal-engine.ts) aplica estas regras.
 * Material de referência do projeto: uma metodologia, não garantia de resultado.
 */
import type { AnaliseTecnica, Tendencia } from "./tecnica";

/** Só ativos líquidos. Para ampliar, edite a lista (e confira a liquidez das opções antes). */
export const UNIVERSO_LIQUIDO = ["PETR4", "VALE3", "BBAS3", "ITUB4", "BBDC4", "SANB11", "BOVA11"] as const;
export const noUniverso = (ticker: string) => (UNIVERSO_LIQUIDO as readonly string[]).includes(ticker);

/** Volatilidade (0..1): comprar opção só com IV Rank < 25 e IV Percentil < 30; vender só com IV Rank > 50 e IV Percentil > 80. */
export const IV_COMPRA = { rank: 0.25, percentil: 0.30 } as const;
export const IV_VENDA = { rank: 0.50, percentil: 0.80 } as const;
export const MIN_DIAS_IV = 60; // pregões de histórico de IV para o IV Rank/Percentil valerem

/** Trava/condor de débito: pagar no máximo 1/4 da distância entre os strikes (retorno/risco >= 3). */
export const REGRA_QUARTO = 0.25;
/** Piso de sanidade, não critério de seleção: com retorno/risco >= 3 o ponto de equilíbrio é ~25% de acerto e o método ganha pela
 *  assimetria e pela leitura técnica; a probabilidade do modelo é neutra a direção e não vê essa vantagem. */
export const POP_MIN_DEBITO = 0.10;
export const RISCO_MAX_DEBITO_PCT = 1.5; // % do patrimônio por operação de débito
export const EXPOSICAO_VENDIDA_MAX_PCT = 30;
export const JANELA_VENDA_DU = { min: 25, max: 45 } as const; // dias úteis para vender prêmio
export const DU_MAX_COLLAR = 45;
export const REALIZAR_LUCRO_PCT = 70; // zerar com ~70% do lucro máximo; não esperar o vencimento
export const PREMIO_ZERAR_VENDA_PCT = 70; // vendido: zerar quando a opção perdeu ~70% do valor

/** Distância máxima entre strikes sugerida por ativo (R$), do manual. Outros ativos usam só LARGURA_MAX. */
export const DISTANCIA_MAX_TRAVA: Record<string, number> = { PETR4: 1.5, BBAS3: 1.0, VALE3: 2.0, BOVA11: 2.0 };

/** Vencimento mensal = terceira sexta-feira (ou a quinta anterior, se a sexta for feriado). Semanais ficam de fora. */
export function ehVencimentoMensal(dataStr: string): boolean {
  const d = new Date(`${dataStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  const dia = d.getUTCDate(), sem = d.getUTCDay();
  return (sem === 5 && dia >= 15 && dia <= 21) || (sem === 4 && dia >= 14 && dia <= 20);
}

export type EstadoGate = "ok" | "reprovado" | "sem_historico";
export function gateVolatilidade(lado: "compra" | "venda", ivr: number | null | undefined, ivp: number | null | undefined): { estado: EstadoGate; texto: string } {
  if (ivr == null || ivp == null) return { estado: "sem_historico", texto: `IV Rank/Percentil indisponíveis (menos de ${MIN_DIAS_IV} pregões de histórico): o método exige validar antes de operar` };
  const f = (x: number) => `${(x * 100).toFixed(0)}`;
  if (lado === "compra") {
    return ivr < IV_COMPRA.rank && ivp < IV_COMPRA.percentil
      ? { estado: "ok", texto: `IV Rank ${f(ivr)} e Percentil ${f(ivp)}: volatilidade barata, favorece comprar` }
      : { estado: "reprovado", texto: `IV Rank ${f(ivr)} / Percentil ${f(ivp)}: caro para comprar (exige Rank < 25 e Percentil < 30)` };
  }
  return ivr > IV_VENDA.rank && ivp > IV_VENDA.percentil
    ? { estado: "ok", texto: `IV Rank ${f(ivr)} e Percentil ${f(ivp)}: volatilidade cara, favorece vender` }
    : { estado: "reprovado", texto: `IV Rank ${f(ivr)} / Percentil ${f(ivp)}: barato para vender (exige Rank > 50 e Percentil > 80)` };
}

/** Quais tendências do ativo permitem cada estratégia. "indefinida" não opera: aguarde. */
export const TENDENCIA_PERMITIDA: Record<string, Tendencia[]> = {
  compra_call: ["alta"], trava_alta_call: ["alta"], trava_baixa_put: ["baixa"],
  venda_put: ["alta", "lateral"], lancamento_coberto: ["alta", "lateral"],
  collar: ["alta"], collar_baixa: ["baixa"], condor_call: ["lateral"],
};

export interface PlanoOperacao {
  tese: string;
  tendencia: Tendencia | null;
  sinais_tecnicos: string[];
  stop_ativo: number | null;
  stop_ativo_alto: number | null; // só condor: rompimento para cima
  alvo_ativo: number | null;
  realizar_lucro_pct: number;
  desmontar_ate: string;
  garantia: number | null; // R$ por lote exigidos em caixa/ativo
  perguntas: { risco: string; analise: string; stop: string; manejo: string; alvo: string };
}

const brl = (x: number) => `R$ ${x.toFixed(2).replace(".", ",")}`;

/** Quarta-feira da semana do vencimento: sair antes do vencimento, nunca exercer. */
export function desmontarAte(vencStr: string): string {
  const d = new Date(`${vencStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 2);
  return d.toISOString().slice(0, 10);
}

export function montarPlano(p: {
  estrategia: string; perfil: "debito" | "venda" | "protecao"; direcao: number; venc: string;
  tecnica: AnaliseTecnica | null | undefined; perdaMaxLote: number; lucroMaxLote: number | null; garantia: number | null;
}): PlanoOperacao {
  const t = p.tecnica ?? null;
  const alinhados = !t ? [] : p.direcao < 0 ? t.sinais_baixa : p.direcao > 0 ? t.sinais_alta : [];
  const tese = p.direcao > 0 ? "Alta" : p.direcao < 0 ? "Baixa" : "Lateralização";
  const subindo = p.direcao >= 0;
  const stop = !t ? null : p.direcao === 0 ? t.suporte : subindo ? t.suporte : t.resistencia;
  const alvo = !t ? null : p.direcao === 0 ? null : subindo ? t.resistencia : t.suporte;
  const stopAlto = t && p.direcao === 0 ? t.resistencia : null;
  const realizar = p.perfil === "venda" ? PREMIO_ZERAR_VENDA_PCT : REALIZAR_LUCRO_PCT;
  const risco = p.perfil === "venda"
    ? `Risco é ficar com o ativo: tenha ${p.garantia != null ? brl(p.garantia) : "o valor do lote"} em garantia e aceite o preço médio efetivo.`
    : p.perdaMaxLote > 0 ? `Perde no máximo ${brl(p.perdaMaxLote)} por lote (${p.perfil === "protecao" ? "com o ativo em carteira" : "o débito pago"}).` : "Risco de queda travado pela put acima do preço médio.";
  return {
    tese, tendencia: t?.tendencia ?? null, sinais_tecnicos: alinhados,
    stop_ativo: stop, stop_ativo_alto: stopAlto, alvo_ativo: alvo, realizar_lucro_pct: realizar, desmontar_ate: desmontarAte(p.venc), garantia: p.garantia,
    perguntas: {
      risco,
      analise: !t ? "Análise técnica indisponível (histórico de preços insuficiente)." : p.direcao === 0 ? `Ativo ${t.tendencia}; estrutura ganha se ficar entre os strikes centrais.` : `${alinhados.length} de 5 sinais técnicos a favor da ${tese.toLowerCase()}: ${alinhados.join("; ") || "nenhum"}.`,
      stop: stop != null ? `Stop no ativo (não na opção): ${p.direcao < 0 ? "fechamento acima de" : "fechamento abaixo de"} ${brl(p.direcao === 0 ? stop : stop)}${stopAlto != null ? ` ou acima de ${brl(stopAlto)}` : ""}.` : "Defina o stop no gráfico do ativo antes de entrar.",
      manejo: p.perfil === "debito" ? "Sem manejo: operação de débito sai no stop ou no alvo." : "Decida antes de entrar se vai manejar (rolar) ou sair no stop; o stop vem primeiro.",
      alvo: `Realizar cerca de ${realizar}% do ${p.perfil === "venda" ? "prêmio recebido" : "lucro máximo"}${alvo != null ? ` ou quando o ativo chegar perto de ${brl(alvo)}` : ""}. Desmonte até ${desmontarAte(p.venc).split("-").reverse().join("/")}; nunca leve ao exercício.`,
    },
  };
}
