"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  formatClockMinutes,
  getDueTimeClockReminder,
  TIME_CLOCK_EVENT_LABELS,
  type TimeClockEventValue,
  type TimeClockReminderSettings,
} from "@/lib/time-clock";

export function TimeClockReminder({ settings, registeredEvents }: {
  settings: TimeClockReminderSettings;
  registeredEvents: TimeClockEventValue[];
}) {
  const [now, setNow] = useState(() => new Date());
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const reminder = useMemo(() => getDueTimeClockReminder(settings, registeredEvents, now), [settings, registeredEvents, now]);

  useEffect(() => {
    setPermission("Notification" in window ? Notification.permission : "unsupported");
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!reminder || permission !== "granted") return;
    const interval = Math.max(5, settings.intervalMinutes);
    const bucket = Math.floor(reminder.overdueMinutes / interval);
    const key = `time-clock-reminder:${reminder.dateKey}:${reminder.eventType}:${bucket}`;
    if (localStorage.getItem(key)) return;
    new Notification("Hora de bater o ponto", {
      body: `${TIME_CLOCK_EVENT_LABELS[reminder.eventType]} prevista para ${formatClockMinutes(reminder.dueMinutes)}.`,
      tag: `time-clock-${reminder.dateKey}-${reminder.eventType}`,
    });
    localStorage.setItem(key, "1");
  }, [permission, reminder, settings.intervalMinutes]);

  if (!reminder) return null;
  return (
    <div className="mb-5 flex flex-col justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-black shadow-sm sm:flex-row sm:items-center">
      <div>
        <p className="font-semibold">Aviso de ponto: {TIME_CLOCK_EVENT_LABELS[reminder.eventType]}</p>
        <p className="text-sm text-black/70">Horário previsto: {formatClockMinutes(reminder.dueMinutes)}. O aviso permanecerá até a batida ser registrada.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {permission === "default" && <button className="btn-secondary" onClick={async () => setPermission(await Notification.requestPermission())}>Ativar avisos do navegador</button>}
        <Link className="btn-primary" href="/perfil">Bater ponto</Link>
      </div>
    </div>
  );
}
