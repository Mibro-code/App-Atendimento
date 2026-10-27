"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { UserCombobox, type UserOption } from "@/components/user-combobox";
import { AppointmentFormModal, type AgendaCurrentUser, type AppointmentFormDefaults } from "@/components/agenda/appointment-form";
import { AppointmentDetailModal, runAppointmentAction } from "@/components/agenda/appointment-detail";
import { CustomerAutocomplete, type CustomerOption } from "@/components/agenda/customer-autocomplete";
import { AgendaSkeleton, AppointmentRow, Modal } from "@/components/agenda/agenda-ui";
import { DayView, EmptyPeriod, ListView, MonthView, WeekView } from "@/components/agenda/agenda-views";
import {
  APPOINTMENT_STATUSES,
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_TYPES,
  APPOINTMENT_TYPE_LABELS,
  compareAppointments,
  droppedTiming,
  formatDateKeyBR,
  formatDayTitle,
  formatMonthTitle,
  shiftViewDate,
  toDateKey,
  viewRangeKeys,
  weekKeys,
  type AgendaView,
  type AppointmentDTO,
} from "@/lib/agenda-rules";

const VIEW_LABELS: Record<AgendaView, string> = { hoje: "Hoje", semana: "Semana", mes: "Mês", lista: "Lista" };
const NAV_LABELS: Record<AgendaView, [string, string]> = {
  hoje: ["Dia anterior", "Próximo dia"],
  semana: ["Semana anterior", "Próxima semana"],
  mes: ["Mês anterior", "Próximo mês"],
  lista: ["", ""],
};

interface Filters {
  assignee: UserOption | null;
  assigneeRole: "" | "VENDEDOR" | "REPRESENTANTE";
  type: string;
  status: string;
  customer: CustomerOption | null;
}
const EMPTY_FILTERS: Filters = { assignee: null, assigneeRole: "", type: "", status: "", customer: null };

type FormState = { appointment?: AppointmentDTO; defaults?: AppointmentFormDefaults; focusField?: "date" } | null;

function periodTitle(view: AgendaView, dateKey: string, todayKey: string): string {
  if (view === "mes") return formatMonthTitle(dateKey);
  if (view === "semana") {
    const days = weekKeys(dateKey);
    return `${formatDayTitle(days[0])} – ${formatDayTitle(days[6])}`;
  }
  if (view === "hoje") return dateKey === todayKey ? `Hoje · ${formatDateKeyBR(dateKey)}` : formatDayTitle(dateKey, true);
  return "Próximos compromissos";
}

export function AgendaClient({
  currentUser,
  canViewTeam,
  initialView,
  initialDate,
  initialScope,
  openId,
  newDefaults,
}: {
  currentUser: AgendaCurrentUser;
  canViewTeam: boolean;
  initialView: AgendaView;
  initialDate: string;
  initialScope: "mine" | "team";
  openId: string | null;
  newDefaults: AppointmentFormDefaults | null;
}) {
  const router = useRouter();
  const [view, setView] = useState<AgendaView>(initialView);
  const [dateKey, setDateKey] = useState(initialDate);
  const [scope, setScope] = useState<"mine" | "team">(canViewTeam ? initialScope : "mine");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [items, setItems] = useState<AppointmentDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [detail, setDetail] = useState<AppointmentDTO | null>(null);
  const [form, setForm] = useState<FormState>(newDefaults ? { defaults: newDefaults } : null);
  const [todayKey, setTodayKey] = useState(() => toDateKey(new Date()));
  const showAssignee = scope === "team";

  // Vira o "hoje" se a tela ficar aberta passando da meia-noite.
  useEffect(() => {
    const timer = window.setInterval(() => setTodayKey(toDateKey(new Date())), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  // Mantém a URL compartilhável (?view=&date=) sem recarregar a página.
  useEffect(() => {
    const params = new URLSearchParams({ view, date: dateKey });
    if (scope === "team") params.set("scope", "team");
    window.history.replaceState(null, "", `/agenda?${params.toString()}`);
  }, [view, dateKey, scope]);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (view === "lista") {
      params.set("list", "1");
      if (debouncedSearch) params.set("q", debouncedSearch);
    } else {
      const { fromKey, toKey } = viewRangeKeys(view, dateKey);
      params.set("from", fromKey);
      params.set("to", toKey);
    }
    if (scope === "team") {
      params.set("scope", "team");
      if (filters.assignee) params.set("assignedToId", filters.assignee.id);
      if (filters.assigneeRole) params.set("assigneeRole", filters.assigneeRole);
    }
    if (filters.type) params.set("type", filters.type);
    if (filters.status) params.set("status", filters.status);
    if (filters.customer) params.set("customerId", filters.customer.id);
    return params.toString();
  }, [view, dateKey, scope, filters, debouncedSearch]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/agenda?${query}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const body = await response.json();
        setItems(body.appointments ?? []);
        setHasMore(!!body.hasMore);
        setPage(0);
        setLoading(false);
      })
      .catch((fetchError) => {
        if ((fetchError as Error).name === "AbortError") return;
        setError("Não foi possível carregar sua agenda.");
        setLoading(false);
      });
    return () => controller.abort();
  }, [query, reloadToken]);

  useEffect(() => {
    if (!openId) return;
    fetch(`/api/agenda/${openId}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => { if (body?.appointment) setDetail(body.appointment); })
      .catch(() => undefined);
  }, [openId]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const response = await fetch(`/api/agenda?${query}&page=${page + 1}`);
      if (!response.ok) throw new Error();
      const body = await response.json();
      setItems((current) => [...current, ...(body.appointments ?? [])]);
      setHasMore(!!body.hasMore);
      setPage(page + 1);
    } catch {
      setError("Não foi possível carregar sua agenda.");
    } finally {
      setLoadingMore(false);
    }
  }

  const refreshAll = useCallback(() => {
    setReloadToken((token) => token + 1);
    router.refresh(); // atualiza o badge do menu
  }, [router]);

  // Arrastar e soltar = "Reagendar" no backend. Conflito não move em
  // silêncio: pede confirmação, igual ao formulário.
  const [pendingMove, setPendingMove] = useState<{ item: AppointmentDTO; payload: Record<string, unknown>; message: string } | null>(null);
  const [moving, setMoving] = useState(false);
  const sendMove = useCallback(async (item: AppointmentDTO, payload: Record<string, unknown>, confirmConflicts: boolean) => {
    setMoving(true);
    try {
      const response = await fetch(`/api/agenda/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "RESCHEDULE", ...payload, confirmConflicts }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 409 && body.code === "CONFLICT") {
        setPendingMove({ item, payload, message: body.error });
        return;
      }
      if (!response.ok) throw new Error(body.error);
      setPendingMove(null);
      setItems((current) => current.map((entry) => (entry.id === body.appointment.id ? body.appointment : entry)));
      router.refresh();
    } catch (moveError) {
      setError((moveError as Error).message || "Não foi possível reagendar o compromisso.");
    } finally {
      setMoving(false);
    }
  }, [router]);
  const moveAppointment = useCallback((item: AppointmentDTO, key: string, time?: string) => {
    void sendMove(item, droppedTiming(item, key, time), false);
  }, [sendMove]);

  const complete = useCallback(async (item: AppointmentDTO) => {
    try {
      const updated = await runAppointmentAction(item.id, "COMPLETE");
      setItems((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
      router.refresh();
    } catch {
      setError("Não foi possível concluir o compromisso. Tente novamente.");
    }
  }, [router]);

  function openNew(defaults?: AppointmentFormDefaults) {
    setSelectedDay(null);
    setForm({ defaults: { dateKey: view === "lista" ? todayKey : dateKey, ...defaults } });
  }

  const activeFilterCount =
    (scope === "team" && filters.assignee ? 1 : 0) + (scope === "team" && filters.assigneeRole ? 1 : 0) +
    (filters.type ? 1 : 0) + (filters.status ? 1 : 0) + (filters.customer ? 1 : 0);
  const dayItems = selectedDay ? items.filter((item) => toDateKey(item.startsAt) === selectedDay).sort(compareAppointments) : [];
  const [prevLabel, nextLabel] = NAV_LABELS[view];

  return (
    <div className="space-y-4 pb-16 sm:pb-0">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-gray-900">Agenda</h1>
        {/* .btn-primary é declarada depois dos utilitários (globals.css) e
            sobrescreveria `hidden`; por isso a visibilidade fica no wrapper. */}
        <span className="hidden sm:block">
          <button type="button" className="btn-primary" onClick={() => openNew()}>+ Novo compromisso</button>
        </span>
      </div>

      {canViewTeam && (
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm" role="tablist" aria-label="Agenda exibida">
          {(["mine", "team"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={scope === value}
              onClick={() => setScope(value)}
              className={`rounded-md px-3 py-1.5 font-medium ${scope === value ? "bg-gray-100 text-gray-900" : "text-gray-500 hover:text-gray-800"}`}
            >
              {value === "mine" ? "Minha agenda" : currentUser.role === "ADMIN" ? "Todas as agendas" : "Agenda da equipe"}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="grid grid-cols-4 rounded-lg border border-gray-200 bg-white p-0.5 text-sm lg:inline-grid" role="tablist" aria-label="Visualização">
          {(Object.keys(VIEW_LABELS) as AgendaView[]).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={view === value}
              onClick={() => setView(value)}
              className={`rounded-md px-3 py-2 font-medium lg:py-1.5 ${view === value ? "text-white" : "text-gray-600 hover:text-gray-900"}`}
              style={view === value ? { backgroundColor: "#FF6633" } : undefined}
            >
              {VIEW_LABELS[value]}
            </button>
          ))}
        </div>

        <div className="flex items-end justify-between gap-2 sm:items-center">
          {view !== "lista" ? (
            <div className="flex min-w-0 flex-wrap items-center gap-1">
              <button type="button" className="btn-secondary px-2.5" onClick={() => setDateKey(shiftViewDate(view, dateKey, -1))} aria-label={prevLabel}>
                ‹<span className="ml-1 hidden xl:inline">{prevLabel}</span>
              </button>
              <button type="button" className="btn-secondary px-3" onClick={() => setDateKey(todayKey)}>Hoje</button>
              <button type="button" className="btn-secondary px-2.5" onClick={() => setDateKey(shiftViewDate(view, dateKey, 1))} aria-label={nextLabel}>
                <span className="mr-1 hidden xl:inline">{nextLabel}</span>›
              </button>
              <span className="order-first mb-1 w-full truncate text-sm font-semibold text-gray-900 sm:order-none sm:mb-0 sm:ml-2 sm:w-auto">{periodTitle(view, dateKey, todayKey)}</span>
            </div>
          ) : (
            <span className="text-sm font-semibold text-gray-900">{periodTitle(view, dateKey, todayKey)}</span>
          )}
          <button
            type="button"
            className={`btn-secondary shrink-0 ${showFilters ? "bg-gray-100" : ""}`}
            onClick={() => setShowFilters((value) => !value)}
            aria-expanded={showFilters}
          >
            Filtros{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          </button>
        </div>
      </div>

      {showFilters && (
        <div className="card grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {scope === "team" && (
            <>
              <div>
                <span className="label-field">Responsável</span>
                <UserCombobox
                  searchUrl="/api/users/search?roles=ADMIN,SUPERVISOR,VENDEDOR,REPRESENTANTE"
                  options={filters.assignee ? [filters.assignee] : []}
                  value={filters.assignee?.id ?? ""}
                  emptyLabel="Todos"
                  ariaLabel="Filtrar por responsável"
                  onChange={(_id, option) => setFilters((current) => ({ ...current, assignee: option }))}
                />
              </div>
              <div>
                <label htmlFor="filter-role" className="label-field">Equipe</label>
                <select id="filter-role" className="input-field" value={filters.assigneeRole} onChange={(event) => setFilters((current) => ({ ...current, assigneeRole: event.target.value as Filters["assigneeRole"] }))}>
                  <option value="">Todos</option>
                  <option value="VENDEDOR">Vendedores</option>
                  <option value="REPRESENTANTE">Representantes</option>
                </select>
              </div>
            </>
          )}
          <div>
            <label htmlFor="filter-type" className="label-field">Tipo</label>
            <select id="filter-type" className="input-field" value={filters.type} onChange={(event) => setFilters((current) => ({ ...current, type: event.target.value }))}>
              <option value="">Todos</option>
              {APPOINTMENT_TYPES.map((value) => <option key={value} value={value}>{APPOINTMENT_TYPE_LABELS[value]}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="filter-status" className="label-field">Status</label>
            <select id="filter-status" className="input-field" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
              <option value="">Todos</option>
              {APPOINTMENT_STATUSES.map((value) => <option key={value} value={value}>{APPOINTMENT_STATUS_LABELS[value]}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="filter-customer" className="label-field">Cliente</label>
            <CustomerAutocomplete inputId="filter-customer" value={filters.customer} onChange={(customer) => setFilters((current) => ({ ...current, customer }))} placeholder="Buscar cliente" />
          </div>
          <div className="flex items-end">
            <button type="button" className="text-sm text-gray-500 underline" onClick={() => setFilters(EMPTY_FILTERS)}>Limpar filtros</button>
          </div>
        </div>
      )}

      {view === "lista" && (
        <input
          type="search"
          className="input-field py-2.5 text-base sm:text-sm"
          placeholder="Buscar por título, cliente, empresa ou descrição"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Buscar compromissos"
        />
      )}

      {pendingMove && (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between" role="alert">
          <p><span className="font-medium">{pendingMove.message}</span> Mover &quot;{pendingMove.item.title}&quot; mesmo assim?</p>
          <div className="flex shrink-0 gap-2">
            <button type="button" className="btn-primary" disabled={moving} onClick={() => void sendMove(pendingMove.item, pendingMove.payload, true)}>Mover mesmo assim</button>
            <button type="button" className="btn-secondary" onClick={() => setPendingMove(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {error ? (
        <div className="card p-6 text-center">
          <p className="text-sm text-gray-700">{error}</p>
          <button type="button" className="btn-secondary mt-3" onClick={() => setReloadToken((token) => token + 1)}>Tentar novamente</button>
        </div>
      ) : loading ? (
        view === "mes" ? <div className="card h-96 animate-pulse bg-gray-100" aria-busy="true" aria-label="Carregando agenda" /> : <AgendaSkeleton />
      ) : view === "mes" ? (
        <>
          <MonthView dateKey={dateKey} todayKey={todayKey} items={items} onSelectDay={setSelectedDay} onMove={moveAppointment} />
          {items.length === 0 ? <EmptyPeriod /> : <DragHint />}
        </>
      ) : view === "semana" ? (
        <>
          <WeekView
            dateKey={dateKey}
            todayKey={todayKey}
            items={items}
            onOpen={setDetail}
            onComplete={complete}
            onCreateAt={(key, time) => openNew({ dateKey: key, startTime: time })}
            onMove={moveAppointment}
            showAssignee={showAssignee}
          />
          {items.length === 0 ? <div className="hidden md:block"><EmptyPeriod /></div> : <DragHint />}
        </>
      ) : view === "hoje" ? (
        <DayView items={items} onOpen={setDetail} onComplete={complete} showAssignee={showAssignee} />
      ) : (
        <ListView items={items} onOpen={setDetail} onComplete={complete} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} />
      )}

      {/* Botão fixo no celular, acima da navegação inferior. */}
      <button
        type="button"
        onClick={() => openNew()}
        className="fixed bottom-20 right-4 z-20 inline-flex h-14 items-center gap-2 rounded-full px-5 text-sm font-semibold text-white shadow-lg sm:hidden"
        style={{ backgroundColor: "#FF6633" }}
        aria-label="Novo compromisso"
      >
        <span className="text-xl leading-none">+</span> Novo
      </button>

      {selectedDay && (
        <Modal title={formatDayTitle(selectedDay, true)} onClose={() => setSelectedDay(null)}>
          {dayItems.length > 0 ? (
            <ul className="space-y-2">
              {dayItems.map((item) => (
                <AppointmentRow key={item.id} item={item} onOpen={(entry) => { setSelectedDay(null); setDetail(entry); }} onComplete={complete} showAssignee={showAssignee} />
              ))}
            </ul>
          ) : (
            <p className="py-6 text-center text-sm text-gray-400">Nenhum compromisso neste dia.</p>
          )}
          <button type="button" className="btn-secondary mt-4 w-full py-2.5" onClick={() => openNew({ dateKey: selectedDay })}>
            + Novo compromisso neste dia
          </button>
        </Modal>
      )}

      {detail && (
        <AppointmentDetailModal
          appointment={detail}
          onClose={() => setDetail(null)}
          onEdit={(item) => { setDetail(null); setForm({ appointment: item }); }}
          onReschedule={(item) => { setDetail(null); setForm({ appointment: item, focusField: "date" }); }}
          onChanged={(updated) => { setDetail(updated); refreshAll(); }}
        />
      )}

      {form && (
        <AppointmentFormModal
          currentUser={currentUser}
          appointment={form.appointment}
          defaults={form.defaults}
          focusField={form.focusField}
          onClose={() => setForm(null)}
          onSaved={(saved) => {
            setForm(null);
            // Leva a tela até o dia salvo para o compromisso ser encontrado na hora.
            if (view !== "lista") setDateKey(toDateKey(saved.startsAt));
            setDetail(saved);
            refreshAll();
          }}
        />
      )}
    </div>
  );
}

function DragHint() {
  return <p className="hidden text-xs text-gray-400 md:block">Dica: arraste um compromisso para outro dia ou horário para reagendar.</p>;
}
