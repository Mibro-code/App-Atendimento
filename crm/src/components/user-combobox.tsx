"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ROLE_LABELS, TYPE_LABELS, userOptionMatches, type UserOption } from "@/lib/user-search";
export type { UserOption } from "@/lib/user-search";

/**
 * Seletor de responsável com busca por nome, e-mail, RCA, tipo e região.
 * Com `options` filtra localmente; com `searchUrl` consulta /api/users/search.
 * Envia o id selecionado em um input hidden (`name`) para formulários GET.
 */
export function UserCombobox({
  options,
  searchUrl,
  value,
  onChange,
  name,
  placeholder = "Pesquisar vendedor, representante ou RCA",
  emptyLabel,
  ariaLabel,
}: {
  options?: UserOption[];
  searchUrl?: string;
  value: string;
  onChange?: (id: string, option: UserOption | null) => void;
  name?: string;
  placeholder?: string;
  emptyLabel?: string;
  ariaLabel?: string;
}) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [remote, setRemote] = useState<UserOption[]>([]);
  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState<UserOption | null>(() => options?.find((option) => option.id === value) ?? null);
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelected((current) => (current?.id === value ? current : options?.find((option) => option.id === value) ?? null));
  }, [value, options]);

  useEffect(() => {
    if (!searchUrl || !open) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const url = new URL(searchUrl, window.location.origin);
      url.searchParams.set("q", query);
      fetch(url, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : { users: [] }))
        .then((body) => setRemote(body.users ?? []))
        .catch(() => undefined);
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [searchUrl, query, open]);

  useEffect(() => {
    const close = (event: MouseEvent) => { if (!wrapper.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const results = useMemo(
    () => (searchUrl ? remote : (options ?? []).filter((option) => userOptionMatches(option, query))).slice(0, 50),
    [searchUrl, remote, options, query]
  );

  function choose(option: UserOption | null) {
    setSelected(option);
    setQuery("");
    setOpen(false);
    onChange?.(option?.id ?? "", option);
  }

  return (
    <div ref={wrapper} className="relative">
      {name && <input type="hidden" name={name} value={selected?.id ?? ""} />}
      <input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel ?? placeholder}
        className="input-field"
        placeholder={selected ? `${selected.name}${selected.rca ? ` · RCA ${selected.rca}` : ""}` : emptyLabel ?? placeholder}
        value={open ? query : selected ? `${selected.name}${selected.rca ? ` · RCA ${selected.rca}` : ""}` : ""}
        onFocus={() => { setOpen(true); setActive(0); }}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); setActive(0); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); setActive((index) => Math.min(index + 1, results.length - 1)); }
          else if (event.key === "ArrowUp") { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)); }
          else if (event.key === "Enter" && open) { event.preventDefault(); if (results[active]) choose(results[active]); }
          else if (event.key === "Escape") setOpen(false);
        }}
      />
      {open && (
        <ul id={listId} role="listbox" className="absolute z-40 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-gray-200 bg-white py-1 text-sm shadow-lg">
          {emptyLabel && (
            <li role="option" aria-selected={!selected} className="cursor-pointer px-3 py-2 text-gray-500 hover:bg-gray-50" onMouseDown={(event) => { event.preventDefault(); choose(null); }}>
              {emptyLabel}
            </li>
          )}
          {results.map((option, index) => (
            <li
              key={option.id}
              role="option"
              aria-selected={option.id === selected?.id}
              className={`cursor-pointer px-3 py-2 ${index === active ? "bg-gray-100" : "hover:bg-gray-50"}`}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => { event.preventDefault(); choose(option); }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium text-gray-900">{option.name}</span>
                {option.rca && <span className="shrink-0 text-xs text-gray-400">RCA {option.rca}</span>}
              </div>
              <div className="truncate text-xs text-gray-400">
                {[option.role ? ROLE_LABELS[option.role] ?? option.role : null, option.representativeType ? TYPE_LABELS[option.representativeType] : null, option.email,
                  option.regionScore ? "Atende a região do cliente" : null].filter(Boolean).join(" · ")}
              </div>
            </li>
          ))}
          {results.length === 0 && <li className="px-3 py-2 text-gray-400">Nenhum resultado.</li>}
        </ul>
      )}
    </div>
  );
}
