import { describe, expect, it } from "vitest";
import {
  APPOINTMENT_COLORS,
  droppedTiming,
  isAppointmentColor,
  randomAppointmentColor,
  addMonthsToKey,
  colorForUser,
  compareAppointments,
  effectiveEnd,
  formatDayTitle,
  formatMonthTitle,
  isDateKey,
  isOverdue,
  isReminderActive,
  listGroupOf,
  monthGridKeys,
  overlaps,
  shiftViewDate,
  startOfWeekKey,
  toDateKey,
  toTimeKey,
  viewRangeKeys,
  weekKeys,
  zonedDate,
} from "./agenda-rules";
import { parseAppointmentInput, parseRescheduleInput } from "./agenda-validation";

describe("fuso de São Paulo", () => {
  it("14:30 em SP é 17:30 UTC e volta a ser 14:30 ao exibir", () => {
    const startsAt = zonedDate("2026-10-08", "14:30");
    expect(startsAt.toISOString()).toBe("2026-10-08T17:30:00.000Z");
    expect(toTimeKey(startsAt)).toBe("14:30");
    expect(toDateKey(startsAt)).toBe("2026-10-08");
  });

  it("23:30 em SP continua no mesmo dia (mesmo já sendo o dia seguinte em UTC)", () => {
    const late = zonedDate("2026-10-08", "23:30");
    expect(late.toISOString()).toBe("2026-10-09T02:30:00.000Z");
    expect(toDateKey(late)).toBe("2026-10-08");
  });

  it("valida chaves de data reais", () => {
    expect(isDateKey("2026-02-29")).toBe(false);
    expect(isDateKey("2028-02-29")).toBe(true);
    expect(isDateKey("2026-13-01")).toBe(false);
    expect(isDateKey("08/10/2026")).toBe(false);
  });
});

describe("calendário", () => {
  it("semana começa na segunda", () => {
    expect(startOfWeekKey("2026-10-08")).toBe("2026-10-05"); // quinta -> segunda
    expect(startOfWeekKey("2026-10-11")).toBe("2026-10-05"); // domingo -> segunda anterior
    expect(weekKeys("2026-10-05")).toEqual([
      "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11",
    ]);
  });

  it("grade mensal cobre semanas completas", () => {
    const grid = monthGridKeys("2026-10-15");
    expect(grid[0]).toBe("2026-09-28");
    expect(grid[grid.length - 1]).toBe("2026-11-01");
    expect(grid.length % 7).toBe(0);
  });

  it("intervalos buscados por visualização", () => {
    expect(viewRangeKeys("hoje", "2026-10-05")).toEqual({ fromKey: "2026-10-05", toKey: "2026-10-06" });
    expect(viewRangeKeys("semana", "2026-10-08")).toEqual({ fromKey: "2026-10-05", toKey: "2026-10-12" });
    expect(viewRangeKeys("mes", "2026-10-15")).toEqual({ fromKey: "2026-09-28", toKey: "2026-11-02" });
  });

  it("navegação anterior/próximo", () => {
    expect(shiftViewDate("mes", "2026-01-31", -1)).toBe("2025-12-01");
    expect(shiftViewDate("semana", "2026-10-05", 1)).toBe("2026-10-12");
    expect(shiftViewDate("hoje", "2026-12-31", 1)).toBe("2027-01-01");
    expect(addMonthsToKey("2026-10-05", 3)).toBe("2027-01-01");
  });

  it("títulos em pt-BR", () => {
    expect(formatMonthTitle("2026-10-05")).toBe("Outubro 2026");
    expect(formatDayTitle("2026-10-08")).toBe("08 de outubro");
  });
});

describe("status calculado", () => {
  const now = new Date("2026-10-05T15:00:00.000Z"); // 12:00 em SP

  it("pendente no passado fica atrasado; concluído nunca", () => {
    const past = { startsAt: zonedDate("2026-10-05", "09:00"), allDay: false };
    expect(isOverdue({ ...past, status: "PENDENTE" }, now)).toBe(true);
    expect(isOverdue({ ...past, status: "CONCLUIDO" }, now)).toBe(false);
    expect(isOverdue({ startsAt: zonedDate("2026-10-05", "14:00"), allDay: false, status: "PENDENTE" }, now)).toBe(false);
  });

  it("dia inteiro só atrasa depois que o dia termina", () => {
    const today = { startsAt: zonedDate("2026-10-05"), allDay: true, status: "PENDENTE" };
    expect(isOverdue(today, now)).toBe(false);
    expect(isOverdue({ ...today, startsAt: zonedDate("2026-10-04") }, now)).toBe(true);
  });

  it("grupos da lista", () => {
    const at = (key: string, time = "10:00") => ({ startsAt: zonedDate(key, time), allDay: false, status: "PENDENTE" });
    expect(listGroupOf(at("2026-10-03"), now)).toBe("ATRASADOS");
    expect(listGroupOf({ ...at("2026-10-03"), status: "CONCLUIDO" }, now)).toBe("ANTERIORES");
    expect(listGroupOf(at("2026-10-05", "18:00"), now)).toBe("HOJE");
    expect(listGroupOf(at("2026-10-06"), now)).toBe("AMANHA");
    expect(listGroupOf(at("2026-10-11"), now)).toBe("ESTA_SEMANA");
    expect(listGroupOf(at("2026-10-12"), now)).toBe("PROXIMOS");
  });
});

describe("conflitos", () => {
  const slot = (start: string, end?: string) => ({
    startsAt: zonedDate("2026-10-08", start),
    endsAt: end ? zonedDate("2026-10-08", end) : null,
    allDay: false,
  });

  it("usa duração padrão de 30 min quando não há horário final", () => {
    expect(effectiveEnd(slot("14:30")).toISOString()).toBe(zonedDate("2026-10-08", "15:00").toISOString());
    expect(overlaps(slot("14:30"), slot("14:45"))).toBe(true);
    expect(overlaps(slot("14:30"), slot("15:00"))).toBe(false);
  });

  it("intervalos longos e dia inteiro", () => {
    expect(overlaps(slot("09:00", "12:00"), slot("11:00"))).toBe(true);
    expect(overlaps({ startsAt: zonedDate("2026-10-08"), allDay: true }, slot("11:00"))).toBe(false);
  });

  it("ordena dia inteiro antes dos horários do mesmo dia", () => {
    const items = [slot("09:00"), { startsAt: zonedDate("2026-10-08"), allDay: true }, slot("08:00")];
    expect(items.sort(compareAppointments).map((item) => (item.allDay ? "dia" : toTimeKey(item.startsAt)))).toEqual(["dia", "08:00", "09:00"]);
  });
});

describe("lembretes", () => {
  const base = { startsAt: zonedDate("2026-10-08", "14:30"), allDay: false, status: "PENDENTE", reminderDismissedAt: null };
  it("aparece a partir do aviso e some ao fim do compromisso ou ao dispensar", () => {
    const item = { ...base, reminderMinutes: 15 };
    expect(isReminderActive(item, zonedDate("2026-10-08", "14:10"))).toBe(false);
    expect(isReminderActive(item, zonedDate("2026-10-08", "14:15"))).toBe(true);
    expect(isReminderActive(item, zonedDate("2026-10-08", "15:00"))).toBe(false);
    expect(isReminderActive({ ...item, reminderDismissedAt: new Date() }, zonedDate("2026-10-08", "14:20"))).toBe(false);
    expect(isReminderActive({ ...base, reminderMinutes: null }, zonedDate("2026-10-08", "14:30"))).toBe(false);
  });
});

describe("cor do responsável", () => {
  it("é estável por usuário", () => {
    expect(colorForUser("user-a")).toBe(colorForUser("user-a"));
    expect(colorForUser("user-a")).toMatch(/^#[0-9A-F]{6}$/);
  });
});

describe("validação do formulário", () => {
  it("devolve erro por campo (não só 'Dados inválidos')", () => {
    const result = parseAppointmentInput({ title: "  ", type: "", date: "", allDay: false });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors).toMatchObject({
      title: "Informe o título.",
      type: "Selecione o tipo do compromisso.",
      startTime: "Informe o horário inicial.",
    });
    expect(result.fieldErrors.date).toBeTruthy();
  });

  it("horário final precisa ser depois do inicial", () => {
    const result = parseAppointmentInput({ title: "Retorno", type: "FOLLOW_UP", date: "2026-10-08", startTime: "14:30", endTime: "14:00" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.endTime).toBe("O horário final deve ser depois do inicial.");
  });

  it("dia inteiro dispensa horário e cliente/descrição são opcionais", () => {
    const result = parseAppointmentInput({ title: "Feira", type: "EVENTO", date: "2026-10-08", allDay: true, startTime: "", customerId: "" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.startsAt.toISOString()).toBe("2026-10-08T03:00:00.000Z");
    expect(result.data.endsAt).toBeNull();
    expect(result.data.customerId).toBeNull();
    expect(result.data.priority).toBe("NORMAL");
    expect(result.data.reminderMinutes).toBeNull();
  });

  it("converte horário de SP e lembrete", () => {
    const result = parseAppointmentInput({
      title: "Retorno sobre proposta", type: "FOLLOW_UP", date: "2026-10-08", startTime: "14:30", endTime: "15:00", reminderMinutes: "30",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.startsAt.toISOString()).toBe("2026-10-08T17:30:00.000Z");
    expect(result.data.endsAt?.toISOString()).toBe("2026-10-08T18:00:00.000Z");
    expect(result.data.reminderMinutes).toBe(30);
  });

  it("rejeita lembrete fora das opções", () => {
    const result = parseAppointmentInput({ title: "X", type: "OUTRO", date: "2026-10-08", startTime: "10:00", reminderMinutes: 7 });
    expect(result.ok).toBe(false);
  });

  it("reagendar valida só data/horário", () => {
    expect(parseRescheduleInput({ date: "2026-10-09", startTime: "10:00" }).ok).toBe(true);
    const bad = parseRescheduleInput({ date: "2026-10-09" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.fieldErrors)).toEqual(["startTime"]);
  });
});

describe("cor do compromisso", () => {
  it("aceita só cores da paleta", () => {
    expect(isAppointmentColor(APPOINTMENT_COLORS[0].value)).toBe(true);
    expect(isAppointmentColor("#ff6633")).toBe(true);
    expect(isAppointmentColor("#123456")).toBe(false);
    expect(isAppointmentColor("red")).toBe(false);
  });

  it("cor aleatória vem da paleta e evita repetir a atual", () => {
    const current = APPOINTMENT_COLORS[0].value;
    for (const r of [0, 0.3, 0.99]) {
      const picked = randomAppointmentColor(current, () => r);
      expect(isAppointmentColor(picked)).toBe(true);
      expect(picked).not.toBe(current);
    }
  });

  it("a cor do responsável também é da paleta", () => {
    expect(isAppointmentColor(colorForUser("qualquer-id"))).toBe(true);
  });

  it("validação aceita cor e participantes; recusa cor fora da paleta", () => {
    const ok = parseAppointmentInput({ title: "X", type: "REUNIAO", date: "2026-10-08", startTime: "10:00", color: "#3e63dd", participantIds: ["a", "a", "b"] });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.data.color).toBe("#3E63DD");
      expect(ok.data.participantIds).toEqual(["a", "b"]);
    }
    const bad = parseAppointmentInput({ title: "X", type: "REUNIAO", date: "2026-10-08", startTime: "10:00", color: "#000001" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.fieldErrors.color).toBe("Escolha uma cor da paleta.");
  });
});

describe("arrastar e soltar", () => {
  const item = { startsAt: zonedDate("2026-10-08", "14:30").toISOString(), endsAt: zonedDate("2026-10-08", "15:30").toISOString(), allDay: false };

  it("mês: muda o dia e mantém horário e duração", () => {
    expect(droppedTiming(item, "2026-10-10")).toEqual({ date: "2026-10-10", allDay: false, startTime: "14:30", endTime: "15:30" });
  });

  it("semana: novo horário em passos de 15 min, mantendo a duração", () => {
    expect(droppedTiming(item, "2026-10-09", "09:07")).toEqual({ date: "2026-10-09", allDay: false, startTime: "09:00", endTime: "10:00" });
    expect(droppedTiming(item, "2026-10-09", "09:08")).toEqual({ date: "2026-10-09", allDay: false, startTime: "09:15", endTime: "10:15" });
  });

  it("sem horário final continua sem; não passa da meia-noite", () => {
    expect(droppedTiming({ ...item, endsAt: null }, "2026-10-09", "11:00").endTime).toBeNull();
    expect(droppedTiming(item, "2026-10-09", "23:50")).toEqual({ date: "2026-10-09", allDay: false, startTime: "23:45", endTime: null });
  });

  it("dia inteiro solto num dia continua dia inteiro; solto num horário vira compromisso com hora", () => {
    const allDay = { startsAt: zonedDate("2026-10-08").toISOString(), endsAt: null, allDay: true };
    expect(droppedTiming(allDay, "2026-10-09")).toEqual({ date: "2026-10-09", allDay: true, startTime: null, endTime: null });
    expect(droppedTiming(allDay, "2026-10-09", "10:00")).toEqual({ date: "2026-10-09", allDay: false, startTime: "10:00", endTime: null });
  });
});
