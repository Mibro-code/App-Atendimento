import { describe, expect, it } from "vitest";
import {
  PIPELINE_STAGES,
  attemptStars,
  followUpBucket,
  followUpBucketRange,
  isRepurchase,
  needsAttemptDecision,
  parseCollapsedColumns,
  resolveReturnDate,
  soldReturnDueAt,
  stageAfterStatusChange,
  startsNewCycle,
  statusAfterStageMove,
  toggleCollapsedColumn,
  validateStageMove,
} from "./pipeline-rules";

// 30/09/2026 10:00 em Brasília (quarta-feira).
const NOW = new Date("2026-09-30T13:00:00Z");

describe("funil — etapas", () => {
  it("tem as 7 colunas na ordem pedida", () => {
    expect(PIPELINE_STAGES).toEqual(["NOVO", "EM_ATENDIMENTO", "FOLLOW_UP", "COTACAO", "VENDIDO", "RECICLAGEM", "INATIVO"]);
  });

  it("exige motivo para Inativo e para Reciclagem", () => {
    expect(validateStageMove("EM_ATENDIMENTO", { to: "INATIVO" }, NOW)).toMatch(/motivo/);
    expect(validateStageMove("EM_ATENDIMENTO", { to: "INATIVO", reason: "Sem interesse" }, NOW)).toBeNull();
    expect(validateStageMove("EM_ATENDIMENTO", { to: "RECICLAGEM", reason: " " }, NOW)).toMatch(/motivo/);
    expect(validateStageMove("EM_ATENDIMENTO", { to: "RECICLAGEM", reason: "Demanda sazonal" }, NOW)).toBeNull();
  });

  it("reciclagem retorna somente para Em atendimento e exige data futura", () => {
    const future = new Date("2026-10-15T03:00:00Z");
    expect(validateStageMove("FOLLOW_UP", { to: "RECICLAGEM", reason: "x", returnAt: future, returnTo: "EM_ATENDIMENTO" }, NOW)).toBeNull();
    expect(validateStageMove("FOLLOW_UP", { to: "RECICLAGEM", reason: "x", returnAt: future, returnTo: "FOLLOW_UP" }, NOW)).toMatch(/Em atendimento/);
    expect(validateStageMove("FOLLOW_UP", { to: "RECICLAGEM", reason: "x", returnAt: new Date("2026-09-01T00:00:00Z") }, NOW)).toMatch(/futura/);
    expect(validateStageMove("RECICLAGEM", { to: "EM_ATENDIMENTO" }, NOW)).toBeNull();
    expect(validateStageMove("RECICLAGEM", { to: "INATIVO", reason: "Sem interesse" }, NOW)).toBeNull();
    expect(validateStageMove("RECICLAGEM", { to: "NOVO" }, NOW)).toMatch(/só podem/);
  });

  it("não move para a mesma etapa", () => {
    expect(validateStageMove("COTACAO", { to: "COTACAO" }, NOW)).toMatch(/já está/);
  });

  it("permite acompanhamento após atendimento e diferencia clientes sem compra de recompra", () => {
    expect(validateStageMove("EM_ATENDIMENTO", { to: "FOLLOW_UP" }, NOW)).toBeNull();
    expect(isRepurchase(null, "FOLLOW_UP")).toBe(false);
    expect(isRepurchase(new Date("2026-09-01T13:00:00Z"), "FOLLOW_UP")).toBe(true);
    expect(needsAttemptDecision(2, "FOLLOW_UP")).toBe(false);
    expect(needsAttemptDecision(3, "FOLLOW_UP")).toBe(true);
  });
});

describe("bug: inativo continua ativo", () => {
  it("marcar Inativo grava status INATIVO real (não só visual)", () => {
    expect(statusAfterStageMove("EM_NEGOCIACAO", "INATIVO")).toBe("INATIVO");
    expect(statusAfterStageMove("CLIENTE_ATIVO", "INATIVO")).toBe("INATIVO");
    expect(statusAfterStageMove("INATIVO", "INATIVO")).toBeNull();
  });

  it("status INATIVO / SEM_INTERESSE pelo editor antigo leva o cliente para Inativos", () => {
    expect(stageAfterStatusChange("INATIVO", "EM_ATENDIMENTO")).toBe("INATIVO");
    expect(stageAfterStatusChange("SEM_INTERESSE", "VENDIDO")).toBe("INATIVO");
    expect(stageAfterStatusChange("INATIVO", "INATIVO")).toBeNull();
  });

  it("reativar tira o status inativo", () => {
    expect(statusAfterStageMove("INATIVO", "NOVO")).toBe("NOVO");
    expect(statusAfterStageMove("SEM_INTERESSE", "EM_ATENDIMENTO")).toBe("CONTATO_REALIZADO");
    expect(statusAfterStageMove("INATIVO", "RECICLAGEM")).toBe("AGUARDANDO_RETORNO");
    expect(stageAfterStatusChange("CONTATO_REALIZADO", "INATIVO")).toBe("EM_ATENDIMENTO");
  });

  it("venda perdida vai para Reciclagem (decisão comercial)", () => {
    expect(stageAfterStatusChange("VENDA_PERDIDA", "EM_ATENDIMENTO")).toBe("RECICLAGEM");
    expect(stageAfterStatusChange("VENDA_PERDIDA", "INATIVO")).toBeNull();
  });
});

describe("tentativas de contato (estrelas)", () => {
  it("representa 0 a 3 tentativas", () => {
    expect(attemptStars(0)).toEqual({ filled: 0, total: 3, extra: 0 });
    expect(attemptStars(1).filled).toBe(1);
    expect(attemptStars(2).filled).toBe(2);
    expect(attemptStars(3).filled).toBe(3);
    expect(attemptStars(5)).toEqual({ filled: 3, total: 3, extra: 2 });
  });

  it("após 3 tentativas o vendedor decide — nunca automático em etapa pausada", () => {
    expect(needsAttemptDecision(2, "EM_ATENDIMENTO")).toBe(false);
    expect(needsAttemptDecision(3, "EM_ATENDIMENTO")).toBe(false);
    expect(needsAttemptDecision(3, "FOLLOW_UP")).toBe(true);
    expect(needsAttemptDecision(3, "INATIVO")).toBe(false);
    expect(needsAttemptDecision(3, "RECICLAGEM")).toBe(false);
  });
});

describe("ciclos comerciais", () => {
  it("novo ciclo ao voltar para Novos ou sair de Reciclagem/Inativos", () => {
    expect(startsNewCycle("EM_ATENDIMENTO", "NOVO")).toBe(true);
    expect(startsNewCycle("VENDIDO", "NOVO")).toBe(true);
    expect(startsNewCycle("VENDIDO", "FOLLOW_UP")).toBe(true); // recompra
    expect(startsNewCycle("RECICLAGEM", "FOLLOW_UP")).toBe(true);
    expect(startsNewCycle("INATIVO", "EM_ATENDIMENTO")).toBe(true);
  });

  it("mesmo ciclo dentro do processo comercial e entre etapas pausadas", () => {
    expect(startsNewCycle("NOVO", "EM_ATENDIMENTO")).toBe(false);
    expect(startsNewCycle("EM_ATENDIMENTO", "COTACAO")).toBe(false);
    expect(startsNewCycle("EM_ATENDIMENTO", "INATIVO")).toBe(false);
    expect(startsNewCycle("INATIVO", "RECICLAGEM")).toBe(false);
  });
});

describe("Voltar em / retorno", () => {
  it("presets usam o calendário de Brasília (início do dia)", () => {
    expect(resolveReturnDate("1", null, NOW)?.toISOString()).toBe("2026-10-01T03:00:00.000Z");
    expect(resolveReturnDate("3", null, NOW)?.toISOString()).toBe("2026-10-03T03:00:00.000Z");
    expect(resolveReturnDate("7", null, NOW)?.toISOString()).toBe("2026-10-07T03:00:00.000Z");
    expect(resolveReturnDate("15", null, NOW)?.toISOString()).toBe("2026-10-15T03:00:00.000Z");
    expect(resolveReturnDate("30", null, NOW)?.toISOString()).toBe("2026-10-30T03:00:00.000Z");
  });

  it("data personalizada precisa ser futura", () => {
    expect(resolveReturnDate("custom", "2026-11-20", NOW)?.toISOString()).toBe("2026-11-20T03:00:00.000Z");
    expect(resolveReturnDate("custom", "2026-09-01", NOW)).toBeNull();
    expect(resolveReturnDate("custom", "20/11/2026", NOW)).toBeNull();
    expect(resolveReturnDate("99", null, NOW)).toBeNull();
  });

  it("vendido volta como recompra após o prazo (padrão 30 dias)", () => {
    const soldAt = new Date("2026-09-01T12:00:00Z");
    expect(soldReturnDueAt(soldAt, 30).toISOString()).toBe("2026-10-01T12:00:00.000Z");
    expect(soldReturnDueAt(soldAt, null).toISOString()).toBe("2026-10-01T12:00:00.000Z");
    expect(soldReturnDueAt(soldAt, 15).toISOString()).toBe("2026-09-16T12:00:00.000Z");
  });

  it("recompra = já comprou e está em etapa de oportunidade", () => {
    const sale = new Date("2026-08-01T00:00:00Z");
    expect(isRepurchase(sale, "NOVO")).toBe(true);
    expect(isRepurchase(sale, "COTACAO")).toBe(true);
    expect(isRepurchase(sale, "VENDIDO")).toBe(false);
    expect(isRepurchase(sale, "INATIVO")).toBe(false);
    expect(isRepurchase(null, "NOVO")).toBe(false);
  });
});

describe("filtros de follow-up", () => {
  it("classifica vencido, hoje, amanhã, esta semana, futuro e sem data", () => {
    expect(followUpBucket(new Date("2026-09-29T20:00:00Z"), NOW)).toBe("OVERDUE");
    expect(followUpBucket(new Date("2026-09-30T23:00:00Z"), NOW)).toBe("TODAY"); // 20h em Brasília
    expect(followUpBucket(new Date("2026-10-01T15:00:00Z"), NOW)).toBe("TOMORROW");
    expect(followUpBucket(new Date("2026-10-04T15:00:00Z"), NOW)).toBe("WEEK"); // domingo
    expect(followUpBucket(new Date("2026-10-06T15:00:00Z"), NOW)).toBe("FUTURE");
    expect(followUpBucket(null, NOW)).toBe("NONE");
  });

  it("faixas usadas nas consultas", () => {
    expect(followUpBucketRange("OVERDUE", NOW)).toEqual({ lt: new Date("2026-09-30T03:00:00Z") });
    expect(followUpBucketRange("WEEK", NOW)).toEqual({ gte: new Date("2026-09-30T03:00:00Z"), lt: new Date("2026-10-05T03:00:00Z") });
  });
});

describe("colunas recolhíveis", () => {
  it("recolhe e abre novamente mantendo a ordem do funil", () => {
    let collapsed = toggleCollapsedColumn([], "INATIVO");
    expect(collapsed).toEqual(["INATIVO"]);
    collapsed = toggleCollapsedColumn(collapsed, "NOVO");
    expect(collapsed).toEqual(["NOVO", "INATIVO"]);
    collapsed = toggleCollapsedColumn(collapsed, "INATIVO");
    expect(collapsed).toEqual(["NOVO"]);
  });

  it("estado da sessão é lido com segurança", () => {
    expect(parseCollapsedColumns(JSON.stringify(["FOLLOW_UP", "INATIVO"]))).toEqual(["FOLLOW_UP", "INATIVO"]);
    expect(parseCollapsedColumns(JSON.stringify(["X", "COTACAO"]))).toEqual(["COTACAO"]);
    expect(parseCollapsedColumns("não é json")).toEqual([]);
    expect(parseCollapsedColumns(null)).toEqual([]);
  });
});
