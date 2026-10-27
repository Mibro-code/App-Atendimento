"use client";

import { useEffect, useId, useRef, useState } from "react";

export interface CustomerOption {
  id: string;
  name: string;
  detail?: string;
}

/**
 * Busca de cliente por nome, empresa, CPF, CNPJ ou telefone (mínimo 2
 * caracteres). A pesquisa e o escopo de carteira são feitos no backend.
 */
export function CustomerAutocomplete({
  value,
  onChange,
  invalid,
  inputId,
  placeholder = "Buscar por nome, empresa, CPF, CNPJ ou telefone",
}: {
  value: CustomerOption | null;
  onChange: (value: CustomerOption | null) => void;
  invalid?: boolean;
  inputId?: string;
  placeholder?: string;
}) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<CustomerOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || query.trim().length < 2) { setResults([]); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      fetch(`/api/agenda/customers?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : { customers: [] }))
        .then((body) => { setResults(body.customers ?? []); setActive(0); })
        .catch(() => undefined)
        .finally(() => setLoading(false));
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, open]);

  useEffect(() => {
    const close = (event: MouseEvent) => { if (!wrapper.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function choose(option: CustomerOption) {
    onChange(option);
    setQuery("");
    setOpen(false);
  }

  if (value && !open) {
    return (
      <div className={`flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm ${invalid ? "border-red-500" : "border-gray-300"}`}>
        <span className="min-w-0 truncate font-medium text-gray-900">{value.name}</span>
        <span className="flex shrink-0 gap-1">
          <button type="button" className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100" onClick={() => setOpen(true)}>Trocar</button>
          <button type="button" className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100" onClick={() => onChange(null)} aria-label="Remover cliente">Remover</button>
        </span>
      </div>
    );
  }

  return (
    <div ref={wrapper} className="relative">
      <input
        id={inputId}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        className={`input-field ${invalid ? "input-field-error" : ""}`}
        placeholder={placeholder}
        value={query}
        autoFocus={!!value}
        onFocus={() => setOpen(true)}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); setActive((index) => Math.min(index + 1, results.length - 1)); }
          else if (event.key === "ArrowUp") { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)); }
          else if (event.key === "Enter" && open && results[active]) { event.preventDefault(); choose(results[active]); }
          else if (event.key === "Escape") { setOpen(false); }
        }}
      />
      {open && query.trim().length >= 2 && (
        <ul id={listId} role="listbox" className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-gray-200 bg-white py-1 text-sm shadow-lg">
          {results.map((option, index) => (
            <li
              key={option.id}
              role="option"
              aria-selected={index === active}
              className={`cursor-pointer px-3 py-2.5 ${index === active ? "bg-gray-100" : "hover:bg-gray-50"}`}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => { event.preventDefault(); choose(option); }}
            >
              <p className="truncate font-medium text-gray-900">{option.name}</p>
              {option.detail && <p className="truncate text-xs text-gray-400">{option.detail}</p>}
            </li>
          ))}
          {!loading && results.length === 0 && <li className="px-3 py-2 text-gray-400">Nenhum cliente encontrado.</li>}
          {loading && results.length === 0 && <li className="px-3 py-2 text-gray-400">Buscando…</li>}
        </ul>
      )}
      {value && open && (
        <button type="button" className="mt-1 text-xs text-gray-500 underline" onClick={() => setOpen(false)}>Manter {value.name}</button>
      )}
    </div>
  );
}
