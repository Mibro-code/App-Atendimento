import { describe, expect, it } from "vitest";
import { activityActionRequest } from "./activity-center-actions";
import { parseRescheduleInput } from "./agenda-validation";
import type { ActivityItem } from "./activity-center-rules";

const item: ActivityItem = { key: "CRM_AGENDA:a", source: "CRM_AGENDA", id: "a", title: "Visita", kind: "Visita", at: "2026-10-21T12:00:00Z", endsAt: "2026-10-21T14:00:00Z", allDay: false, state: "PENDENTE", priority: "NORMAL", assignee: null, customer: null, company: null, conversationId: null, note: null, canEdit: true, completedAt: null };

describe("activity actions preserve original agenda semantics", () => {
  it("keeps the two-hour duration through the real API validator", () => {
    const request = activityActionRequest(item, "RESCHEDULE", "2026-10-24", "10:00");
    expect(request.body).toMatchObject({ startTime: "10:00", endTime: "12:00", allDay: false });
    const parsed = parseRescheduleInput(request.body);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.data.endsAt!.getTime() - parsed.data.startsAt.getTime()).toBe(2 * 3600000);
  });
  it("keeps whole-day appointments as whole-day, without inventing a time", () => {
    const request = activityActionRequest({ ...item, allDay: true, endsAt: null }, "RESCHEDULE", "2026-10-24", "09:00");
    expect(request.body).toMatchObject({ allDay: true });
    expect(request.body).not.toHaveProperty("startTime");
    const parsed = parseRescheduleInput(request.body);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.data.allDay).toBe(true);
  });
  it("keeps an absent end time absent", () => {
    expect(activityActionRequest({ ...item, endsAt: null }, "RESCHEDULE", "2026-10-24", "10:00").body).not.toHaveProperty("endTime");
  });
  it("rejects unsupported next-day endings instead of silently truncating duration", () => {
    expect(() => activityActionRequest(item, "RESCHEDULE", "2026-10-24", "23:30")).toThrow(/dia seguinte/);
  });
  it("routes completion to the original record without copying it", () => {
    expect(activityActionRequest(item, "COMPLETE", "", "")).toMatchObject({ url: "/api/agenda/a", method: "PATCH", body: { action: "COMPLETE" } });
    expect(activityActionRequest({ ...item, source: "CENTRAL" }, "COMPLETE", "", "")).toMatchObject({ url: "/api/activity-center", method: "POST", body: { id: "a", action: "COMPLETE" } });
  });
  it("preserves conflict confirmation and Sao Paulo time for repurchase", () => {
    expect(activityActionRequest(item, "RESCHEDULE", "2026-10-24", "10:00", true).body).toMatchObject({ confirmConflicts: true });
    expect(activityActionRequest({ ...item, source: "CRM_RECOMPRA" }, "RESCHEDULE", "2026-10-24", "10:00").body).toMatchObject({ newDueAt: "2026-10-24T13:00:00.000Z" });
  });
});
