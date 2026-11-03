import { describe, expect, it } from "vitest";
import {
  canUseTimeClock,
  getDueTimeClockReminder,
  computeDailySummary,
  getBrazilWorkDate,
  getBrazilWorkDateKey,
  getExpectedClockOutAt,
  isEarlyDeparture,
} from "./time-clock";
import {
  validateAttendanceDocument,
  validateAttendanceDocumentContent,
} from "./attendance-document-validation";

describe("regras do ponto", () => {
  it("usa a data de São Paulo mesmo quando o servidor está em UTC", () => {
    const instant = new Date("2026-09-01T01:30:00.000Z");
    expect(getBrazilWorkDateKey(instant)).toBe("2026-08-31");
    expect(getBrazilWorkDate(instant).toISOString()).toBe("2026-08-31T00:00:00.000Z");
  });

  it("libera vendedores e supervisores, mas não administradores", () => {
    expect(canUseTimeClock("VENDEDOR")).toBe(true);
    expect(canUseTimeClock("SUPERVISOR")).toBe(true);
    expect(canUseTimeClock("ADMIN")).toBe(false);
    expect(canUseTimeClock("REPRESENTANTE")).toBe(false);
  });
});

describe("lembretes do ponto", () => {
  const settings = { enabled:true,requiredEvents:["CLOCK_IN","CLOCK_OUT"] as const,workingDays:[1,2,3,4,5],start:540,lunchStart:720,lunchEnd:780,end:1080,intervalMinutes:15 };
  it("avisa a entrada atrasada em dia útil", () => expect(getDueTimeClockReminder({ ...settings, requiredEvents:[...settings.requiredEvents] }, [], new Date("2026-09-21T12:30:00Z"))?.eventType).toBe("CLOCK_IN"));
  it("avisa a saída depois da entrada", () => expect(getDueTimeClockReminder({ ...settings, requiredEvents:[...settings.requiredEvents] }, ["CLOCK_IN"], new Date("2026-09-21T21:30:00Z"))?.eventType).toBe("CLOCK_OUT"));
  it("não avisa em fim de semana", () => expect(getDueTimeClockReminder({ ...settings, requiredEvents:[...settings.requiredEvents] }, [], new Date("2026-09-20T15:00:00Z"))).toBeNull());
  it("não cobra entrada depois de uma marcação posterior", () => expect(getDueTimeClockReminder({ ...settings, requiredEvents:[...settings.requiredEvents] }, ["LUNCH_START"], new Date("2026-09-21T15:30:00Z"))).toBeNull());
});

describe("saída antecipada", () => {
  const workDate = new Date("2026-09-02T00:00:00.000Z"); // 02/09 civil de São Paulo

  it("calcula o horário esperado de saída no fuso de São Paulo (padrão 18:00)", () => {
    expect(getExpectedClockOutAt(workDate).toISOString()).toBe("2026-09-02T21:00:00.000Z");
  });

  it("marca como antecipada uma saída antes do horário esperado", () => {
    const early = new Date("2026-09-02T20:00:00.000Z"); // 17:00 em São Paulo
    expect(isEarlyDeparture(early, workDate)).toBe(true);
  });

  it("não marca como antecipada uma saída no horário esperado ou depois", () => {
    const onTime = new Date("2026-09-02T21:30:00.000Z"); // 18:30 em São Paulo
    expect(isEarlyDeparture(onTime, workDate)).toBe(false);
  });
});

describe("resumo diário (computeDailySummary)", () => {
  const workDate = new Date("2026-09-02T00:00:00.000Z");

  it("NOT_STARTED quando não há nenhum registro no dia", () => {
    const summary = computeDailySummary([], { workDate, now: new Date("2026-09-02T14:00:00.000Z") });
    expect(summary.status).toBe("NOT_STARTED");
    expect(summary.nextAction).toBe("CLOCK_IN");
    expect(summary.workedMinutes).toBe(0);
  });

  it("WORKING logo após a entrada, com próxima ação = intervalo", () => {
    const summary = computeDailySummary(
      [{ eventType: "CLOCK_IN", occurredAt: "2026-09-02T12:00:00.000Z" }],
      { workDate, now: new Date("2026-09-02T13:00:00.000Z") }
    );
    expect(summary.status).toBe("WORKING");
    expect(summary.nextAction).toBe("LUNCH_START");
    expect(summary.workedMinutes).toBe(60);
  });

  it("ON_BREAK durante o intervalo (não soma o tempo de intervalo)", () => {
    const summary = computeDailySummary(
      [
        { eventType: "CLOCK_IN", occurredAt: "2026-09-02T12:00:00.000Z" },
        { eventType: "LUNCH_START", occurredAt: "2026-09-02T15:00:00.000Z" },
      ],
      { workDate, now: new Date("2026-09-02T15:30:00.000Z") }
    );
    expect(summary.status).toBe("ON_BREAK");
    expect(summary.nextAction).toBe("LUNCH_END");
    expect(summary.workedMinutes).toBe(180);
  });

  it("permite continuar o dia pelo app mesmo sem entrada registrada nele", () => {
    const summary = computeDailySummary(
      [{ eventType: "LUNCH_END", occurredAt: "2026-09-02T16:00:00.000Z" }],
      { workDate, now: new Date("2026-09-02T17:00:00.000Z") }
    );
    expect(summary.status).toBe("WORKING");
    expect(summary.nextAction).toBe("CLOCK_OUT");
  });

  it("FINISHED com saída registrada soma os dois turnos (manhã + tarde)", () => {
    const summary = computeDailySummary([
      { eventType: "CLOCK_IN", occurredAt: "2026-09-02T12:00:00.000Z" },
      { eventType: "LUNCH_START", occurredAt: "2026-09-02T15:00:00.000Z" },
      { eventType: "LUNCH_END", occurredAt: "2026-09-02T16:00:00.000Z" },
      { eventType: "CLOCK_OUT", occurredAt: "2026-09-02T21:00:00.000Z" },
    ]);
    expect(summary.status).toBe("FINISHED");
    expect(summary.nextAction).toBeNull();
    expect(summary.workedMinutes).toBe(3 * 60 + 5 * 60); // 08:00 - 8h totais
  });

  it("dia passado sem saída fica INCOMPLETE e não soma horas do turno em aberto", () => {
    const pastDay = new Date("2026-08-30T00:00:00.000Z");
    const summary = computeDailySummary(
      [{ eventType: "CLOCK_IN", occurredAt: "2026-08-30T12:00:00.000Z" }],
      { workDate: pastDay, now: new Date("2026-09-02T14:00:00.000Z") }
    );
    expect(summary.status).toBe("INCOMPLETE");
    expect(summary.nextAction).toBeNull();
    expect(summary.workedMinutes).toBe(0);
  });
});

describe("validação de documento de ocorrência (attendance-storage)", () => {
  it("aceita JPG, PNG e PDF dentro do limite de tamanho", () => {
    expect(validateAttendanceDocument({ type: "image/jpeg", size: 1024 })).toBeNull();
    expect(validateAttendanceDocument({ type: "image/png", size: 1024 })).toBeNull();
    expect(validateAttendanceDocument({ type: "application/pdf", size: 1024 })).toBeNull();
  });

  it("rejeita tipo não permitido", () => {
    expect(validateAttendanceDocument({ type: "application/zip", size: 1024 })?.code).toBe("INVALID_TYPE");
  });

  it("rejeita arquivo maior que 10MB", () => {
    expect(validateAttendanceDocument({ type: "image/jpeg", size: 11 * 1024 * 1024 })?.code).toBe("TOO_LARGE");
  });

  it("rejeita arquivo vazio", () => {
    expect(validateAttendanceDocument({ type: "image/jpeg", size: 0 })?.code).toBe("EMPTY");
  });

  it("valida a assinatura real em vez de confiar somente no MIME", () => {
    expect(validateAttendanceDocumentContent(new Uint8Array([0xff, 0xd8, 0xff, 0x00]), "image/jpeg")).toBeNull();
    expect(
      validateAttendanceDocumentContent(new TextEncoder().encode("<script>alert(1)</script>"), "image/jpeg")?.code
    ).toBe("INVALID_CONTENT");
  });
});
