"use client";

import { useEffect, useRef, useState } from "react";
import { UserCombobox, type UserOption } from "@/components/user-combobox";
import {
  APPOINTMENT_PRIORITIES,
  APPOINTMENT_PRIORITY_LABELS,
  APPOINTMENT_TYPES,
  APPOINTMENT_TYPE_LABELS,
  APPOINTMENT_COLORS,
  REMINDER_OPTIONS,
  colorForUser,
  randomAppointmentColor,
  toDateKey,
  toTimeKey,
  type AppointmentDTO,
  type AppointmentTypeValue,
} from "@/lib/agenda-rules";
import { CustomerAutocomplete, type CustomerOption } from "./customer-autocomplete";
import { Modal, timeRangeLabel } from "./agenda-ui";

export interface AgendaCurrentUser {
  id: string;
  name: string;
  role: string;
}

export interface AppointmentFormDefaults {
  dateKey?: string;
  startTime?: string;
  customer?: CustomerOption | null;
  type?: AppointmentTypeValue;
}

/** Próxima meia hora cheia para hoje; 09:00 para outros dias. */
function suggestedStartTime(dateKey: string): string {
  const now = new Date();
  if (dateKey !== toDateKey(now)) return "09:00";
  const [h, m] = toTimeKey(now).split(":").map(Number);
  const next = h * 60 + m + (30 - (m % 30));
  if (next >= 24 * 60) return "23:30";
  return `${String(Math.floor(next / 60)).padStart(2, "0")}:${String(next % 60).padStart(2, "0")}`;
}

const REQUIRED = <span className="text-red-600" aria-hidden> *</span>;

function FieldError({ message, id }: { message?: string; id: string }) {
  if (!message) return null;
  return <p id={id} className="mt-1 text-xs text-red-600">{message}</p>;
}

/**
 * Formulário único de compromisso: criação (Agenda, dia do calendário,
 * ficha do cliente) e edição/reagendamento. Erros aparecem embaixo de cada
 * campo; conflito de horário só avisa e permite salvar mesmo assim.
 */
export function AppointmentFormModal({
  currentUser,
  appointment,
  defaults,
  focusField,
  onClose,
  onSaved,
}: {
  currentUser: AgendaCurrentUser;
  appointment?: AppointmentDTO | null;
  defaults?: AppointmentFormDefaults;
  focusField?: "date";
  onClose: () => void;
  onSaved: (appointment: AppointmentDTO) => void;
}) {
  const editing = !!appointment;
  const initialDate = appointment ? toDateKey(appointment.startsAt) : defaults?.dateKey ?? toDateKey(new Date());
  const [title, setTitle] = useState(appointment?.title ?? "");
  const [type, setType] = useState<string>(appointment?.type ?? defaults?.type ?? "");
  const [customer, setCustomer] = useState<CustomerOption | null>(
    appointment?.customer ? { id: appointment.customer.id, name: appointment.customer.name } : defaults?.customer ?? null
  );
  const [date, setDate] = useState(initialDate);
  const [allDay, setAllDay] = useState(appointment?.allDay ?? false);
  const [startTime, setStartTime] = useState(
    appointment && !appointment.allDay ? toTimeKey(appointment.startsAt) : defaults?.startTime ?? suggestedStartTime(initialDate)
  );
  const [endTime, setEndTime] = useState(appointment?.endsAt ? toTimeKey(appointment.endsAt) : "");
  const [assignee, setAssignee] = useState<UserOption>(
    appointment ? { id: appointment.assignedTo.id, name: appointment.assignedTo.name } : { id: currentUser.id, name: currentUser.name }
  );
  const [description, setDescription] = useState(appointment?.description ?? "");
  const [priority, setPriority] = useState(appointment?.priority ?? "NORMAL");
  const [reminder, setReminder] = useState(appointment?.reminderMinutes == null ? "" : String(appointment.reminderMinutes));
  const [color, setColor] = useState<string | null>(appointment?.customColor ?? null);
  const [participants, setParticipants] = useState<UserOption[]>(appointment?.participants ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ message: string; items: Array<{ id: string; title: string; startsAt: string; endsAt: string | null }> } | null>(null);
  const [saving, setSaving] = useState(false);
  const dateRef = useRef<HTMLInputElement>(null);
  const canChooseAssignee = currentUser.role === "SUPERVISOR" || currentUser.role === "ADMIN";
  // "Reagendar": só data e horário, focado na data.
  const rescheduleOnly = editing && focusField === "date";

  useEffect(() => {
    if (focusField === "date") dateRef.current?.focus();
  }, [focusField]);

  function validateLocally(): Record<string, string> {
    const next: Record<string, string> = {};
    if (!title.trim()) next.title = "Informe o título.";
    if (!type) next.type = "Selecione o tipo do compromisso.";
    if (!date) next.date = "Informe a data.";
    if (!allDay && !startTime) next.startTime = "Informe o horário inicial.";
    if (!allDay && startTime && endTime && endTime <= startTime) next.endTime = "O horário final deve ser depois do inicial.";
    return next;
  }

  async function submit(confirmConflicts = false) {
    setFormError(null);
    const local = validateLocally();
    setErrors(local);
    if (Object.keys(local).length > 0) return;

    setSaving(true);
    const payload = {
      ...(editing ? { action: rescheduleOnly ? "RESCHEDULE" : "UPDATE" } : {}),
      title, type, date, allDay,
      startTime: allDay ? null : startTime,
      endTime: allDay ? null : endTime || null,
      customerId: customer?.id ?? null,
      assignedToId: assignee.id,
      description, priority,
      reminderMinutes: reminder,
      color,
      participantIds: participants.map((participant) => participant.id),
      confirmConflicts,
    };
    try {
      const response = await fetch(editing ? `/api/agenda/${appointment!.id}` : "/api/agenda", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 409 && body.code === "CONFLICT") {
        setConflict({ message: body.error, items: body.conflicts ?? [] });
        return;
      }
      if (!response.ok) {
        setErrors(body.fieldErrors ?? {});
        setFormError(body.fieldErrors ? null : body.error || "Não foi possível salvar o compromisso.");
        setConflict(null);
        return;
      }
      onSaved(body.appointment);
    } catch {
      setFormError("Sem conexão. Verifique a internet e tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  const inputClass = (field: string) => `input-field py-2.5 text-base sm:text-sm ${errors[field] ? "input-field-error" : ""}`;
  const describedBy = (field: string) => (errors[field] ? `appointment-${field}-error` : undefined);

  return (
    <Modal title={editing ? (focusField === "date" ? "Reagendar compromisso" : "Editar compromisso") : "Novo compromisso"} onClose={onClose}>
      <form
        className="space-y-4"
        noValidate
        onSubmit={(event) => { event.preventDefault(); void submit(false); }}
      >
        {rescheduleOnly ? (
          <p className="text-sm text-gray-600">
            <span className="font-medium text-gray-900">{title}</span>
            {customer ? ` · ${customer.name}` : ""}
            {appointment && appointment.status !== "PENDENTE" && <span className="block text-xs text-gray-400">Ao reagendar, o compromisso volta a ficar pendente.</span>}
          </p>
        ) : (<>
        <div>
          <label htmlFor="appointment-title" className="label-field">Título{REQUIRED}</label>
          <input
            id="appointment-title"
            className={inputClass("title")}
            value={title}
            maxLength={160}
            autoFocus={!editing}
            placeholder="Ex.: Retorno sobre proposta"
            onChange={(event) => setTitle(event.target.value)}
            aria-invalid={!!errors.title}
            aria-describedby={describedBy("title")}
          />
          <FieldError id="appointment-title-error" message={errors.title} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="appointment-type" className="label-field">Tipo{REQUIRED}</label>
            <select id="appointment-type" className={inputClass("type")} value={type} onChange={(event) => setType(event.target.value)} aria-invalid={!!errors.type} aria-describedby={describedBy("type")}>
              <option value="">Selecione</option>
              {APPOINTMENT_TYPES.map((value) => <option key={value} value={value}>{APPOINTMENT_TYPE_LABELS[value]}</option>)}
            </select>
            <FieldError id="appointment-type-error" message={errors.type} />
          </div>
          <div>
            <label htmlFor="appointment-priority" className="label-field">Prioridade</label>
            <select id="appointment-priority" className={inputClass("priority")} value={priority} onChange={(event) => setPriority(event.target.value)}>
              {APPOINTMENT_PRIORITIES.map((value) => <option key={value} value={value}>{APPOINTMENT_PRIORITY_LABELS[value]}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="appointment-customer" className="label-field">Cliente</label>
          <CustomerAutocomplete inputId="appointment-customer" value={customer} onChange={setCustomer} invalid={!!errors.customerId} />
          <FieldError id="appointment-customerId-error" message={errors.customerId} />
        </div>
        </>)}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="col-span-2 sm:col-span-1">
            <label htmlFor="appointment-date" className="label-field">Data{REQUIRED}</label>
            <input ref={dateRef} id="appointment-date" type="date" className={inputClass("date")} value={date} onChange={(event) => setDate(event.target.value)} aria-invalid={!!errors.date} aria-describedby={describedBy("date")} />
            <FieldError id="appointment-date-error" message={errors.date} />
          </div>
          {!allDay && (
            <>
              <div>
                <label htmlFor="appointment-start" className="label-field">Início{REQUIRED}</label>
                <input id="appointment-start" type="time" className={inputClass("startTime")} value={startTime} onChange={(event) => setStartTime(event.target.value)} aria-invalid={!!errors.startTime} aria-describedby={describedBy("startTime")} />
                <FieldError id="appointment-startTime-error" message={errors.startTime} />
              </div>
              <div>
                <label htmlFor="appointment-end" className="label-field">Fim</label>
                <input id="appointment-end" type="time" className={inputClass("endTime")} value={endTime} onChange={(event) => setEndTime(event.target.value)} aria-invalid={!!errors.endTime} aria-describedby={describedBy("endTime")} />
                <FieldError id="appointment-endTime-error" message={errors.endTime} />
              </div>
            </>
          )}
        </div>
        <label className="flex min-h-[44px] items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" className="h-5 w-5 rounded border-gray-300" checked={allDay} onChange={(event) => setAllDay(event.target.checked)} />
          Dia inteiro
        </label>
        {!allDay && !endTime && <p className="-mt-3 text-xs text-gray-400">Sem horário final, consideramos 30 minutos.</p>}

        {!rescheduleOnly && (<>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <span className="label-field">Responsável</span>
            {canChooseAssignee ? (
              <UserCombobox
                options={[assignee]}
                searchUrl="/api/users/search?roles=ADMIN,SUPERVISOR,VENDEDOR,REPRESENTANTE"
                value={assignee.id}
                onChange={(_id, option) => { if (option) setAssignee(option); }}
                placeholder="Pesquisar pessoa da equipe"
                ariaLabel="Responsável"
              />
            ) : (
              <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-700">{assignee.id === currentUser.id ? `${currentUser.name} (você)` : assignee.name}</p>
            )}
            <FieldError id="appointment-assignedToId-error" message={errors.assignedToId} />
          </div>
          <div>
            <label htmlFor="appointment-reminder" className="label-field">Lembrete</label>
            <select id="appointment-reminder" className={inputClass("reminderMinutes")} value={reminder} onChange={(event) => setReminder(event.target.value)}>
              {REMINDER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <FieldError id="appointment-reminderMinutes-error" message={errors.reminderMinutes} />
          </div>
        </div>

        <ColorPicker value={color} defaultColor={colorForUser(assignee.id)} onChange={setColor} error={errors.color} />

        {canChooseAssignee && (
          <ParticipantsField
            participants={participants}
            excludeIds={[assignee.id]}
            canAddWholeTeam={currentUser.role === "SUPERVISOR"}
            currentUserId={currentUser.id}
            onChange={setParticipants}
            error={errors.participantIds}
          />
        )}

        <div>
          <label htmlFor="appointment-description" className="label-field">Descrição / observação</label>
          <textarea id="appointment-description" rows={3} className={inputClass("description")} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Ex.: Cliente pediu retorno após conversar com o sócio." />
          <FieldError id="appointment-description-error" message={errors.description} />
        </div>
        </>)}

        {conflict && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
            <p className="font-medium">{conflict.message}</p>
            <ul className="mt-1 space-y-0.5 text-xs">
              {conflict.items.slice(0, 3).map((item) => (
                <li key={item.id}>{timeRangeLabel({ startsAt: item.startsAt, endsAt: item.endsAt, allDay: false })} · {item.title}</li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="btn-primary" disabled={saving} onClick={() => void submit(true)}>Salvar mesmo assim</button>
              <button type="button" className="btn-secondary" onClick={() => setConflict(null)}>Ajustar horário</button>
            </div>
          </div>
        )}

        {formError && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{formError}</p>}

        {!conflict && (
          <div className="sticky bottom-0 -mx-5 flex flex-col-reverse gap-2 border-t border-gray-100 bg-white px-5 pt-3 sm:flex-row sm:justify-end">
            <button type="button" className="btn-secondary py-2.5" onClick={onClose}>Voltar</button>
            <button type="submit" className="btn-primary py-2.5" disabled={saving}>
              {saving ? "Salvando…" : rescheduleOnly ? "Reagendar" : editing ? "Salvar alterações" : "Agendar"}
            </button>
          </div>
        )}
      </form>
    </Modal>
  );
}

/**
 * Cor do compromisso: "Padrão" (cor do responsável), uma da paleta ou
 * aleatória. Usada só como marcador fino nas visualizações.
 */
function ColorPicker({
  value,
  defaultColor,
  onChange,
  error,
}: {
  value: string | null;
  defaultColor: string;
  onChange: (value: string | null) => void;
  error?: string;
}) {
  const swatch = (selected: boolean) =>
    `flex h-9 w-9 items-center justify-center rounded-full border-2 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 ${selected ? "scale-110 border-gray-900 dark:border-white" : "border-transparent hover:scale-105"}`;
  return (
    <fieldset>
      <div className="mb-1 flex items-center justify-between gap-2">
        <legend className="label-field mb-0">Cor</legend>
        <button type="button" className="rounded-md px-2 py-1 text-xs font-medium text-gray-600 underline hover:bg-gray-100" onClick={() => onChange(randomAppointmentColor(value ?? defaultColor))}>
          Cor aleatória
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Cor do compromisso">
        <button type="button" role="radio" aria-checked={value === null} title="Padrão (cor do responsável)" aria-label="Padrão (cor do responsável)" className={`${swatch(value === null)} w-auto gap-1.5 px-2.5 text-xs text-gray-600`} onClick={() => onChange(null)}>
          <span aria-hidden className="h-4 w-4 rounded-full" style={{ backgroundColor: defaultColor }} /> Padrão
        </button>
        {APPOINTMENT_COLORS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            aria-label={option.label}
            title={option.label}
            className={swatch(value === option.value)}
            onClick={() => onChange(option.value)}
          >
            <span aria-hidden className="h-6 w-6 rounded-full" style={{ backgroundColor: option.value }} />
          </button>
        ))}
      </div>
      <FieldError id="appointment-color-error" message={error} />
    </fieldset>
  );
}

/**
 * Evento compartilhado: pessoas que também verão o compromisso (somente
 * leitura). A busca respeita o RBAC (supervisor só encontra a própria equipe)
 * e o backend revalida cada convite.
 */
function ParticipantsField({
  participants,
  excludeIds,
  canAddWholeTeam,
  currentUserId,
  onChange,
  error,
}: {
  participants: UserOption[];
  excludeIds: string[];
  canAddWholeTeam: boolean;
  currentUserId: string;
  onChange: (participants: UserOption[]) => void;
  error?: string;
}) {
  const [loadingTeam, setLoadingTeam] = useState(false);
  const add = (options: UserOption[]) => {
    const known = new Set([...participants.map((participant) => participant.id), ...excludeIds]);
    const fresh = new Map(options.filter((option) => !known.has(option.id)).map((option) => [option.id, option]));
    onChange([...participants, ...fresh.values()]);
  };

  async function addWholeTeam() {
    setLoadingTeam(true);
    try {
      const response = await fetch("/api/users/search?roles=VENDEDOR,REPRESENTANTE&limit=50");
      const body = response.ok ? await response.json() : { users: [] };
      add((body.users ?? []).filter((user: UserOption) => user.id !== currentUserId));
    } finally {
      setLoadingTeam(false);
    }
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="label-field mb-0">Compartilhar com</span>
        {canAddWholeTeam && (
          <button type="button" className="rounded-md px-2 py-1 text-xs font-medium text-gray-600 underline hover:bg-gray-100" disabled={loadingTeam} onClick={() => void addWholeTeam()}>
            {loadingTeam ? "Adicionando…" : "Toda a equipe"}
          </button>
        )}
      </div>
      <UserCombobox
        searchUrl="/api/users/search?roles=ADMIN,SUPERVISOR,VENDEDOR,REPRESENTANTE"
        value=""
        placeholder="Adicionar participante"
        ariaLabel="Adicionar participante"
        onChange={(_id, option) => { if (option) add([option]); }}
      />
      {participants.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Participantes">
          {participants.map((participant) => (
            <li key={participant.id} className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 py-1 pl-3 pr-1 text-xs text-gray-700">
              {participant.name}
              <button
                type="button"
                className="rounded-full px-1.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
                aria-label={`Remover ${participant.name}`}
                onClick={() => onChange(participants.filter((item) => item.id !== participant.id))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-xs text-gray-400">Participantes veem o evento na própria agenda; só o responsável altera.</p>
      <FieldError id="appointment-participantIds-error" message={error} />
    </div>
  );
}
