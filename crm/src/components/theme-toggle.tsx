"use client";

import { useEffect, useState } from "react";

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("crm-theme", next ? "dark" : "light");
    setDark(next);
  }

  return (
    <button type="button" className="btn-secondary" onClick={toggle} aria-label={dark ? "Ativar modo claro" : "Ativar modo noturno"}>
      <span>{compact ? (dark ? "Claro" : "Noturno") : (dark ? "Modo claro" : "Modo noturno")}</span>
    </button>
  );
}
