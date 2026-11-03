import { toDateKey, zonedDate } from "./agenda-rules";
import type { ActivityItem } from "./activity-center-rules";

const timeFormat = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

/** The original API remains authoritative for permissions and conflicts. */
export function activityActionRequest(item: ActivityItem, action: "COMPLETE" | "RESCHEDULE", date: string, time: string, confirmConflicts = false) {
  if (item.source === "CRM_AGENDA") {
    let endTime: string | undefined;
    if (action === "RESCHEDULE" && !item.allDay && item.endsAt) {
      const duration = new Date(item.endsAt).getTime() - new Date(item.at).getTime();
      if (!Number.isFinite(duration) || duration <= 0) throw new Error("Confira a duração do compromisso na agenda de origem.");
      const end = new Date(zonedDate(date, time).getTime() + duration);
      if (toDateKey(end) !== date) throw new Error("Esse horário faria o compromisso terminar no dia seguinte. Escolha outro horário ou edite na agenda de origem.");
      endTime = timeFormat.format(end);
    }
    return {
      url: `/api/agenda/${encodeURIComponent(item.id)}`,
      method: "PATCH",
      body: action === "COMPLETE" ? { action } : {
        action, date, allDay: item.allDay, confirmConflicts,
        ...(!item.allDay ? { startTime: time, ...(endTime ? { endTime } : {}) } : {}),
      },
    };
  }
  if (item.source === "CRM_RECOMPRA") {
    return {
      url: `/api/followups/${encodeURIComponent(item.id)}`,
      method: "PATCH",
      body: action === "COMPLETE" ? { action } : { action: "POSTPONE", newDueAt: zonedDate(date, time).toISOString() },
    };
  }
  return { url: "/api/activity-center", method: "POST", body: action === "COMPLETE" ? { id: item.id, action } : { id: item.id, action, date, time } };
}
