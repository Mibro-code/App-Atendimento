import { auth } from "@/auth";
import { EmployeeDashboard } from "./employee-dashboard";
import { SupervisorDashboard } from "./supervisor-dashboard";
import { TimeClockReminder } from "./time-clock-reminder";
import { prisma } from "@/lib/prisma";
import { canUseTimeClock, getBrazilWorkDate } from "@/lib/time-clock";

export default async function DashboardPage() {
  const session = await auth();
  const user = { id: session!.user.id, role: session!.user.role };
  const reminderData = canUseTimeClock(user.role) ? await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: {
      timeClockReminderEnabled:true,timeClockRequiredEvents:true,timeClockWorkingDays:true,
      timeClockStartMinutes:true,timeClockLunchStartMinutes:true,timeClockLunchEndMinutes:true,
      timeClockEndMinutes:true,timeClockReminderIntervalMinutes:true,
    }}),
    prisma.timeClockEntry.findMany({ where: { userId:user.id, workDate:getBrazilWorkDate() }, select:{ eventType:true } }),
  ]) : null;
  const content = user.role === "SUPERVISOR" || user.role === "ADMIN"
    ? <SupervisorDashboard />
    : <EmployeeDashboard user={user} />;
  if (!reminderData?.[0]) return content;
  const [settings, entries] = reminderData;
  return <><TimeClockReminder settings={{
    enabled:settings.timeClockReminderEnabled,requiredEvents:settings.timeClockRequiredEvents,
    workingDays:settings.timeClockWorkingDays,start:settings.timeClockStartMinutes,
    lunchStart:settings.timeClockLunchStartMinutes,lunchEnd:settings.timeClockLunchEndMinutes,
    end:settings.timeClockEndMinutes,intervalMinutes:settings.timeClockReminderIntervalMinutes,
  }} registeredEvents={entries.map((entry)=>entry.eventType)} />{content}</>;
}
