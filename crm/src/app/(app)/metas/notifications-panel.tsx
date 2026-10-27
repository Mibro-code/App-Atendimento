"use client";

import { useState } from "react";

interface NotificationItem {
  id: string;
  title: string;
  message: string;
}

export function NotificationsPanel({ initialNotifications }: { initialNotifications: NotificationItem[] }) {
  const [items, setItems] = useState(initialNotifications);

  async function markRead(id: string) {
    setItems((prev) => prev.filter((n) => n.id !== id));
    await fetch(`/api/notifications/${id}`, { method: "PATCH" });
  }

  if (items.length === 0) return null;

  return (
    <div className="card p-4 space-y-2 border border-amber-200 bg-amber-50">
      <h2 className="text-sm font-semibold text-amber-800">Avisos</h2>
      <ul className="space-y-2">
        {items.map((n) => (
          <li key={n.id} className="flex items-start justify-between gap-3 text-sm">
            <div>
              <p className="font-medium text-gray-900">{n.title}</p>
              <p className="text-gray-600">{n.message}</p>
            </div>
            <button className="text-xs text-brand hover:underline shrink-0" onClick={() => markRead(n.id)}>
              Marcar como lido
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
