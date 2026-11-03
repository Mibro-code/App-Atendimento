"use client";

import { useRef, useState } from "react";
import {
  LIST_GROUP_LABELS,
  LIST_GROUP_ORDER,
  WEEKDAY_SHORT_LABELS,
  compareAppointments,
  effectiveEnd,
  formatDateKeyBR,
  listGroupOf,
  monthGridKeys,
  toDateKey,
  toTimeKey,
  weekKeys,
  type AppointmentDTO,
  type ListGroup,
} from "@/lib/agenda-rules";
import { AppointmentRow, MIBRO_ORANGE, itemToneClass, relativeDayLabel, titleToneClass } from "./agenda-ui";

type OpenHandler = (item: AppointmentDTO) => void;

function groupByDay(items: AppointmentDTO[]): Map<string, AppointmentDTO[]> {
  const map = new Map<string, AppointmentDTO[]>();
  for (const item of [...items].sort(compareAppointments)) {
    const key = toDateKey(item.startsAt);
    map.set(key, [...(map.get(key) ?? []), item]);
  }
  return map;
}

export function EmptyPeriod() {
  return <p className="py-10 text-center text-sm text-gray-400">Nenhum compromisso para este período.</p>;
}

function Dot({ color }: { color: string }) {
  return <span aria-hidden className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />;
}

// ---------------------------------------------------------------------------
// Mês: no máximo 3 itens por célula (só pontos no celular) + "+N".
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Arrastar e soltar (desktop): só compromissos pendentes que o usuário pode
// editar. O drop vira um "Reagendar" comum no backend (mesmas validações,
// auditoria e aviso de conflito). No celular continua o botão Reagendar.
// ---------------------------------------------------------------------------
export type MoveHandler = (item: AppointmentDTO, dateKey: string, time?: string) => void;
const DRAG_TYPE = "application/x-agenda-appointment";

export function canDragAppointment(item: AppointmentDTO): boolean {
  return item.canEdit && item.status === "PENDENTE";
}

function dragSource(item: AppointmentDTO, onStart?: (event: React.DragEvent<HTMLElement>) => void) {
  if (!canDragAppointment(item)) return {};
  return {
    draggable: true,
    title: "Arraste para reagendar",
    onDragStart: (event: React.DragEvent<HTMLElement>) => {
      event.stopPropagation();
      event.dataTransfer.setData(DRAG_TYPE, item.id);
      event.dataTransfer.effectAllowed = "move";
      onStart?.(event);
    },
  };
}

function isAgendaDrag(event: React.DragEvent): boolean {
  return event.dataTransfer.types.includes(DRAG_TYPE);
}

function draggedItem(event: React.DragEvent, items: AppointmentDTO[]): AppointmentDTO | undefined {
  const id = event.dataTransfer.getData(DRAG_TYPE);
  return items.find((item) => item.id === id);
}

export function MonthView({
  dateKey,
  todayKey,
  items,
  onSelectDay,
  onMove,
}: {
  dateKey: string;
  todayKey: string;
  items: AppointmentDTO[];
  onSelectDay: (dateKey: string) => void;
  onMove?: MoveHandler;
}) {
  const [dropKey, setDropKey] = useState<string | null>(null);
  const grid = monthGridKeys(dateKey);
  const month = dateKey.slice(0, 7);
  // Cancelados ficam fora da célula para não poluir; aparecem ao abrir o dia.
  const byDay = groupByDay(items.filter((item) => item.status !== "CANCELADO"));

  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-7 border-b border-gray-100 text-center text-[11px] font-medium uppercase tracking-wide text-gray-400">
        {WEEKDAY_SHORT_LABELS.map((label) => <div key={label} className="py-2">{label}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {grid.map((key) => {
          const list = byDay.get(key) ?? [];
          const outside = key.slice(0, 7) !== month;
          const isToday = key === todayKey;
          const extra = list.length - 3;
          return (
            <div
              key={key}
              role="button"
              tabIndex={0}
              onClick={() => onSelectDay(key)}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelectDay(key); } }}
              onDragOver={onMove ? (event) => { if (isAgendaDrag(event)) { event.preventDefault(); setDropKey(key); } } : undefined}
              onDragLeave={onMove ? () => setDropKey((current) => (current === key ? null : current)) : undefined}
              onDrop={onMove ? (event) => {
                event.preventDefault();
                setDropKey(null);
                const item = draggedItem(event, items);
                if (item && toDateKey(item.startsAt) !== key) onMove(item, key);
              } : undefined}
              aria-label={`${formatDateKeyBR(key)}: ${list.length} compromisso(s)`}
              className={`flex min-h-[3.75rem] min-w-0 cursor-pointer flex-col items-start border-b border-r border-gray-100 p-1 text-left transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-400 md:min-h-[6.75rem] md:p-1.5 [&:nth-child(7n)]:border-r-0 ${outside ? "bg-gray-50/70" : ""} ${dropKey === key ? "!bg-orange-50 ring-2 ring-inset ring-orange-300" : ""}`}
            >
              <span
                className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs tabular-nums ${isToday ? "font-semibold text-white" : outside ? "text-gray-300" : "text-gray-700"}`}
                style={isToday ? { backgroundColor: MIBRO_ORANGE } : undefined}
              >
                {Number(key.slice(8))}
              </span>
              <ul className="mt-1 hidden w-full space-y-0.5 md:block">
                {list.slice(0, 3).map((item) => (
                  <li key={item.id} {...dragSource(item)} className={`flex min-w-0 items-center gap-1 rounded text-[11px] leading-4 text-gray-700 ${canDragAppointment(item) ? "cursor-grab active:cursor-grabbing" : ""} ${itemToneClass(item)}`}>
                    <Dot color={item.color} />
                    {!item.allDay && <span className="shrink-0 tabular-nums text-gray-500">{toTimeKey(item.startsAt)}</span>}
                    <span className={`truncate ${titleToneClass(item)}`}>{item.title}</span>
                  </li>
                ))}
                {extra > 0 && <li className="pl-2.5 text-[11px] text-gray-400">+ {extra} {extra === 1 ? "compromisso" : "compromissos"}</li>}
              </ul>
              {list.length > 0 && (
                <span className="mt-1 flex items-center gap-0.5 md:hidden">
                  {list.slice(0, 3).map((item) => <Dot key={item.id} color={item.color} />)}
                  {extra > 0 && <span className="text-[10px] leading-none text-gray-400">+{extra}</span>}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Semana: grade de horários no desktop; lista por dia no celular (uma grade
// de 7 colunas em 360px não é utilizável).
// ---------------------------------------------------------------------------
const HOUR_PX = 48;

interface PositionedItem { item: AppointmentDTO; lane: number; lanes: number; startMin: number; endMin: number }

function layoutDay(list: AppointmentDTO[]): PositionedItem[] {
  const laneEnds: number[] = [];
  const placed = list.map((item) => {
    const startMin = minutesOfDay(item.startsAt);
    const endMin = Math.max(startMin + 15, Math.min(24 * 60, endMinutes(item)));
    let lane = laneEnds.findIndex((end) => end <= startMin);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(endMin); } else laneEnds[lane] = endMin;
    return { item, lane, lanes: 0, startMin, endMin };
  });
  return placed.map((entry) => ({ ...entry, lanes: laneEnds.length }));
}

function minutesOfDay(iso: string): number {
  const [h, m] = toTimeKey(iso).split(":").map(Number);
  return h * 60 + m;
}

function endMinutes(item: AppointmentDTO): number {
  const end = effectiveEnd(item);
  // Termina em outro dia: corta no fim do dia de início.
  if (toDateKey(end) !== toDateKey(item.startsAt)) return 24 * 60;
  return minutesOfDay(end.toISOString());
}

export function WeekView({
  dateKey,
  todayKey,
  items,
  onOpen,
  onComplete,
  onCreateAt,
  onMove,
  showAssignee,
}: {
  dateKey: string;
  todayKey: string;
  items: AppointmentDTO[];
  onOpen: OpenHandler;
  onComplete: OpenHandler;
  onCreateAt: (dateKey: string, time: string) => void;
  onMove?: MoveHandler;
  showAssignee: boolean;
}) {
  const [dropKey, setDropKey] = useState<string | null>(null);
  // Distância (px) entre o topo do bloco e o ponto onde ele foi agarrado,
  // para o bloco "cair" onde está visualmente e não pelo cursor.
  const grabOffset = useRef(0);
  const days = weekKeys(dateKey);
  const visible = items.filter((item) => item.status !== "CANCELADO");
  const byDay = groupByDay(visible);
  const timed = visible.filter((item) => !item.allDay);
  const hasAllDay = visible.some((item) => item.allDay);
  const startHour = Math.min(7, ...timed.map((item) => Math.floor(minutesOfDay(item.startsAt) / 60)));
  const endHour = Math.max(20, ...timed.map((item) => Math.ceil(endMinutes(item) / 60)));
  const hours = Array.from({ length: endHour - startHour }, (_, index) => startHour + index);
  const cols = "grid grid-cols-[3.25rem_repeat(7,minmax(0,1fr))]";
  const dropProps = (key: string, timed: boolean) => (onMove ? {
    onDragOver: (event: React.DragEvent<HTMLDivElement>) => { if (isAgendaDrag(event)) { event.preventDefault(); setDropKey(`${key}:${timed}`); } },
    onDragLeave: () => setDropKey((current) => (current === `${key}:${timed}` ? null : current)),
    onDrop: (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDropKey(null);
      const item = draggedItem(event, items);
      if (!item) return;
      if (!timed) { if (toDateKey(item.startsAt) !== key) onMove(item, key); return; }
      const y = event.clientY - event.currentTarget.getBoundingClientRect().top - grabOffset.current;
      const minutes = Math.max(0, Math.min(23 * 60 + 45, startHour * 60 + Math.round(((y / HOUR_PX) * 60) / 15) * 15));
      const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
      if (toDateKey(item.startsAt) === key && !item.allDay && toTimeKey(item.startsAt) === time) return;
      onMove(item, key, time);
    },
  } : {});
  const openKeys = (item: AppointmentDTO) => (event: React.KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(item); } };

  return (
    <>
      <div className="card hidden overflow-hidden md:block">
        <div className={`${cols} border-b border-gray-100`}>
          <div />
          {days.map((key, index) => (
            <div key={key} className="border-l border-gray-100 py-2 text-center">
              <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{WEEKDAY_SHORT_LABELS[index]}</p>
              <p className={`text-sm tabular-nums ${key === todayKey ? "font-semibold" : "text-gray-700"}`} style={key === todayKey ? { color: MIBRO_ORANGE } : undefined}>
                {key.slice(8)}/{key.slice(5, 7)}
              </p>
            </div>
          ))}
        </div>
        {hasAllDay && (
          <div className={`${cols} border-b border-gray-100`}>
            <div className="px-1 py-1.5 text-right text-[10px] text-gray-400">Dia</div>
            {days.map((key) => (
              <div key={key} {...dropProps(key, false)} className={`min-w-0 space-y-0.5 border-l border-gray-100 p-1 ${dropKey === `${key}:false` ? "bg-orange-50" : ""}`}>
                {(byDay.get(key) ?? []).filter((item) => item.allDay).map((item) => (
                  <div key={item.id} role="button" tabIndex={0} {...dragSource(item)} onClick={() => onOpen(item)} onKeyDown={openKeys(item)} className={`block w-full cursor-pointer truncate rounded border border-gray-200 bg-white px-1.5 py-0.5 text-left text-[11px] text-gray-700 ${itemToneClass(item)}`} style={{ borderLeft: `3px solid ${item.color}` }}>
                    <span className={titleToneClass(item)}>{item.title}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        <div className={`${cols} max-h-[70vh] overflow-y-auto`}>
          <div>
            {hours.map((hour) => (
              <div key={hour} className="pr-1.5 text-right text-[10px] tabular-nums text-gray-400" style={{ height: HOUR_PX }}>
                {String(hour).padStart(2, "0")}:00
              </div>
            ))}
          </div>
          {days.map((key) => {
            const positioned = layoutDay((byDay.get(key) ?? []).filter((item) => !item.allDay));
            return (
              <div key={key} {...dropProps(key, true)} className={`relative border-l border-gray-100 ${key === todayKey ? "bg-orange-50/30" : ""} ${dropKey === `${key}:true` ? "!bg-orange-50" : ""}`} style={{ height: hours.length * HOUR_PX }}>
                {hours.map((hour, index) => (
                  <button
                    key={hour}
                    type="button"
                    aria-label={`Novo compromisso em ${formatDateKeyBR(key)} às ${String(hour).padStart(2, "0")}:00`}
                    onClick={() => onCreateAt(key, `${String(hour).padStart(2, "0")}:00`)}
                    className="absolute inset-x-0 border-t border-gray-100 hover:bg-gray-50"
                    style={{ top: index * HOUR_PX, height: HOUR_PX }}
                  />
                ))}
                {positioned.map(({ item, lane, lanes, startMin, endMin }) => {
                  const top = ((startMin - startHour * 60) / 60) * HOUR_PX;
                  const height = Math.max(22, ((endMin - startMin) / 60) * HOUR_PX - 2);
                  return (
                    <div
                      key={item.id}
                      role="button"
                      tabIndex={0}
                      {...dragSource(item, (event) => { grabOffset.current = event.clientY - event.currentTarget.getBoundingClientRect().top; })}
                      onClick={() => onOpen(item)}
                      onKeyDown={openKeys(item)}
                      className={`absolute cursor-pointer overflow-hidden rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-left text-[11px] leading-4 shadow-sm hover:z-10 hover:shadow ${itemToneClass(item)}`}
                      style={{
                        top, height,
                        left: `calc(${(lane / lanes) * 100}% + 2px)`,
                        width: `calc(${100 / lanes}% - 4px)`,
                        borderLeft: `3px solid ${item.color}`,
                      }}
                      title={`${toTimeKey(item.startsAt)} ${item.title}${canDragAppointment(item) ? " — arraste para reagendar" : ""}`}
                    >
                      {height < 40 ? (
                        <span className="block truncate">
                          <span className="tabular-nums text-gray-500">{toTimeKey(item.startsAt)}</span>{" "}
                          <span className={`font-medium text-gray-800 ${titleToneClass(item)}`}>{item.title}</span>
                        </span>
                      ) : (
                        <>
                          <span className="block tabular-nums text-gray-500">{toTimeKey(item.startsAt)}</span>
                          <span className={`block truncate font-medium text-gray-800 ${titleToneClass(item)}`}>{item.title}</span>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-4 md:hidden">
        {days.map((key) => {
          const list = byDay.get(key) ?? [];
          return (
            <section key={key}>
              <h3 className={`mb-2 text-sm font-medium ${key === todayKey ? "" : "text-gray-700"}`} style={key === todayKey ? { color: MIBRO_ORANGE } : undefined}>
                {relativeDayLabel(key)}
                {!relativeDayLabel(key).includes("/") && <span className="ml-1 font-normal text-gray-400">{formatDateKeyBR(key).slice(0, 5)}</span>}
              </h3>
              {list.length > 0 ? (
                <ul className="space-y-2">
                  {list.map((item) => <AppointmentRow key={item.id} item={item} onOpen={onOpen} onComplete={onComplete} showAssignee={showAssignee} />)}
                </ul>
              ) : (
                <p className="pl-[4.25rem] text-xs text-gray-300">Sem compromissos</p>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Hoje (ou um dia qualquer navegado a partir dele).
// ---------------------------------------------------------------------------
export function DayView({
  items,
  onOpen,
  onComplete,
  showAssignee,
}: {
  items: AppointmentDTO[];
  onOpen: OpenHandler;
  onComplete: OpenHandler;
  showAssignee: boolean;
}) {
  if (items.length === 0) return <div className="card"><EmptyPeriod /></div>;
  return (
    <ul className="space-y-2">
      {[...items].sort(compareAppointments).map((item) => (
        <AppointmentRow key={item.id} item={item} onOpen={onOpen} onComplete={onComplete} showAssignee={showAssignee} />
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Lista: Atrasados / Hoje / Amanhã / Esta semana / Próximos, paginada.
// ---------------------------------------------------------------------------
export function ListView({
  items,
  onOpen,
  onComplete,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  items: AppointmentDTO[];
  onOpen: OpenHandler;
  onComplete: OpenHandler;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  if (items.length === 0) return <div className="card"><EmptyPeriod /></div>;
  const groups = new Map<ListGroup, AppointmentDTO[]>();
  for (const item of [...items].sort(compareAppointments)) {
    const group = listGroupOf(item);
    groups.set(group, [...(groups.get(group) ?? []), item]);
  }
  return (
    <div className="space-y-6">
      {LIST_GROUP_ORDER.filter((group) => groups.has(group)).map((group) => (
        <section key={group}>
          <h3 className={`mb-2 text-xs font-semibold uppercase tracking-wide ${group === "ATRASADOS" ? "text-amber-700 dark:text-amber-400" : "text-gray-400"}`}>
            {LIST_GROUP_LABELS[group]} <span className="font-normal">({groups.get(group)!.length})</span>
          </h3>
          <ul className="space-y-2">
            {groups.get(group)!.map((item) => (
              <AppointmentRow
                key={item.id}
                item={item}
                onOpen={onOpen}
                onComplete={onComplete}
                showAssignee
                dateLabel={group === "HOJE" ? undefined : relativeDayLabel(toDateKey(item.startsAt))}
              />
            ))}
          </ul>
        </section>
      ))}
      {hasMore && (
        <div className="text-center">
          <button type="button" className="btn-secondary" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? "Carregando…" : "Carregar mais"}
          </button>
        </div>
      )}
    </div>
  );
}
