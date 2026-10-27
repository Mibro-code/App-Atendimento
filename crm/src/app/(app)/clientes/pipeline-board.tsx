"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { PipelineStage } from "@prisma/client";
import type { PipelineCardDto, PipelineColumnDto } from "@/lib/pipeline-board";
import {
  COLLAPSED_COLUMNS_STORAGE_KEY,
  FOLLOW_UP_BUCKET_LABELS,
  INACTIVE_REASONS,
  PIPELINE_STAGES,
  PIPELINE_STAGE_META,
  RECYCLE_REASONS,
  RETURN_OPTIONS,
  attemptStars,
  brazilDateKey,
  followUpBucket,
  needsAttemptDecision,
  parseCollapsedColumns,
  toggleCollapsedColumn,
  type FollowUpBucket,
} from "@/lib/pipeline-rules";
import { formatCommissionPercent } from "@/lib/representative-commission";
import { UserCombobox, type UserOption } from "@/components/user-combobox";

const TEMPERATURE_LABELS: Record<string, string> = { QUENTE: "Quente", MORNO: "Morno", FRIO: "Frio", SEM_CLASSIFICACAO: "Sem classificação" };
const CHANNELS = [["WHATSAPP", "WhatsApp"], ["TELEFONE", "Telefone"], ["EMAIL", "E-mail"], ["VISITA", "Visita"], ["REUNIAO", "Reunião"]] as const;
const money = (cents: number | null | undefined) => ((cents ?? 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const shortDate = (iso: string | null) => iso ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" }).format(new Date(iso)) : "—";

/** Movimentos que exigem informação extra antes de persistir. */
const NEEDS_DETAILS: PipelineStage[] = ["INATIVO", "RECICLAGEM", "VENDIDO", "FOLLOW_UP", "NOVO"];

export type Modal =
  | { kind: "contact"; card: PipelineCardDto }
  | { kind: "move"; card: PipelineCardDto; to: PipelineStage }
  | { kind: "schedule"; card: PipelineCardDto };

interface ColumnState extends PipelineColumnDto {
  loading?: boolean;
  filter?: Record<string, string>;
}

export function Stars({ attempts }: { attempts: number }) {
  const { filled, total, extra } = attemptStars(attempts);
  const label = attempts === 0 ? "Nenhuma tentativa de contato neste ciclo" : `${attempts} tentativa(s) de contato neste ciclo`;
  return (
    <span className="inline-flex items-center gap-0.5 text-sm leading-none" title={label} aria-label={label}>
      {Array.from({ length: total }, (_, index) => (
        <span key={index} className={index < filled ? "text-amber-500" : "text-gray-300"}>{index < filled ? "★" : "☆"}</span>
      ))}
      {extra > 0 && <span className="ml-0.5 text-[10px] text-gray-500">+{extra}</span>}
    </span>
  );
}

export function PipelineBoard({
  initialColumns,
  filterQuery,
  canSeeSeller,
  currentUserId,
  sellerOptions,
}: {
  initialColumns: PipelineColumnDto[];
  filterQuery: string;
  canSeeSeller: boolean;
  currentUserId: string;
  sellerOptions: UserOption[];
}) {
  const [columns, setColumns] = useState<ColumnState[]>(initialColumns);
  const [collapsed, setCollapsed] = useState<PipelineStage[]>([]);
  const [modal, setModal] = useState<Modal | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<PipelineStage | null>(null);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  useEffect(() => setColumns(initialColumns), [initialColumns]);
  useEffect(() => {
    try { setCollapsed(parseCollapsedColumns(sessionStorage.getItem(COLLAPSED_COLUMNS_STORAGE_KEY))); } catch { /* sem sessionStorage */ }
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  function toggle(stage: PipelineStage) {
    setCollapsed((current) => {
      const next = toggleCollapsedColumn(current, stage);
      try { sessionStorage.setItem(COLLAPSED_COLUMNS_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignora */ }
      return next;
    });
  }

  const cardIndex = useMemo(() => {
    const map = new Map<string, PipelineCardDto>();
    columns.forEach((column) => column.cards.forEach((card) => map.set(card.id, card)));
    return map;
  }, [columns]);

  /** Aplica o card atualizado localmente (sem recarregar o funil inteiro). */
  function placeCard(card: PipelineCardDto, previousStage: PipelineStage) {
    setColumns((current) => current.map((column) => {
      const without = column.cards.filter((item) => item.id !== card.id);
      const hadCard = without.length !== column.cards.length;
      if (column.stage === card.stage) {
        const cards = hadCard ? column.cards.map((item) => (item.id === card.id ? card : item)) : [card, ...without];
        return { ...column, cards, count: column.count + (previousStage !== card.stage ? 1 : 0) };
      }
      if (column.stage === previousStage && previousStage !== card.stage) {
        return { ...column, cards: without, count: Math.max(0, column.count - 1) };
      }
      return hadCard ? { ...column, cards: without } : column;
    }));
  }

  async function send(url: string, body: unknown, card: PipelineCardDto, optimisticStage?: PipelineStage) {
    const previousStage = card.stage;
    if (optimisticStage) placeCard({ ...card, stage: optimisticStage }, previousStage);
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (optimisticStage) placeCard(card, optimisticStage); // desfaz
      setNotice({ text: data.error || "Não foi possível salvar.", error: true });
      return false;
    }
    if (data.card) placeCard(data.card, optimisticStage ?? previousStage);
    return data;
  }

  function requestMove(card: PipelineCardDto, to: PipelineStage) {
    setMenuFor(null);
    if (to === "VENDIDO") {
      setNotice({ text: "Vendidos é atualizado automaticamente quando o pedido é aprovado na Olist.", error: true });
      return;
    }
    if (card.stage === to) return;
    if (NEEDS_DETAILS.includes(to)) return setModal({ kind: "move", card, to });
    void send(`/api/customers/${card.id}/stage`, { action: "MOVE", to }, card, to).then((ok) => {
      if (ok) setNotice({ text: `${card.name} movido para ${PIPELINE_STAGE_META[to].label}.` });
    });
  }

  async function loadMore(stage: PipelineStage) {
    const column = columns.find((item) => item.stage === stage)!;
    setColumns((current) => current.map((item) => (item.stage === stage ? { ...item, loading: true } : item)));
    const params = new URLSearchParams(filterQuery);
    Object.entries(column.filter ?? {}).forEach(([key, value]) => params.set(key, value));
    params.set("column", stage);
    params.set("skip", String(column.cards.length));
    const data = await fetch(`/api/pipeline/cards?${params}`).then((response) => response.json()).catch(() => ({ cards: [] }));
    setColumns((current) => current.map((item) => {
      if (item.stage !== stage) return item;
      const known = new Set(item.cards.map((card) => card.id));
      return { ...item, loading: false, cards: [...item.cards, ...(data.cards ?? []).filter((card: PipelineCardDto) => !known.has(card.id))] };
    }));
  }

  async function applyColumnFilter(stage: PipelineStage, filter: Record<string, string>) {
    setColumns((current) => current.map((item) => (item.stage === stage ? { ...item, loading: true, filter } : item)));
    const params = new URLSearchParams(filterQuery);
    Object.entries(filter).forEach(([key, value]) => params.set(key, value));
    params.set("column", stage);
    params.set("withCount", "1");
    const data = await fetch(`/api/pipeline/cards?${params}`).then((response) => response.json()).catch(() => ({ cards: [], count: 0 }));
    setColumns((current) => current.map((item) => (item.stage === stage ? { ...item, loading: false, cards: data.cards ?? [], count: data.count ?? 0 } : item)));
  }

  return (
    <div>
      {notice && (
        <div role="status" className={`mb-3 rounded-md px-3 py-2 text-sm ${notice.error ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>{notice.text}</div>
      )}
      <div className="flex snap-x snap-mandatory items-start gap-3 overflow-x-auto pb-3 sm:snap-none">
        {columns.map((column) => {
          const meta = PIPELINE_STAGE_META[column.stage];
          const isCollapsed = collapsed.includes(column.stage);
          const dropProps = {
            onDragOver: (event: React.DragEvent) => { if (dragId) { event.preventDefault(); setDropTarget(column.stage); } },
            onDragLeave: () => setDropTarget((current) => (current === column.stage ? null : current)),
            onDrop: (event: React.DragEvent) => {
              event.preventDefault();
              setDropTarget(null);
              const card = dragId ? cardIndex.get(dragId) : null;
              setDragId(null);
              if (card) requestMove(card, column.stage);
            },
          };
          if (isCollapsed) {
            return (
              <button
                key={column.stage}
                type="button"
                {...dropProps}
                onClick={() => toggle(column.stage)}
                title={`${meta.label} (${column.count}) — clique para abrir`}
                aria-label={`Abrir coluna ${meta.label}, ${column.count} clientes`}
                aria-expanded={false}
                className={`flex h-[34rem] w-12 shrink-0 snap-start flex-col items-center gap-3 rounded-xl border-t-4 py-3 transition-all duration-200 hover:brightness-95 ${meta.column} ${dropTarget === column.stage ? "ring-2 ring-brand" : ""}`}
              >
                <span className="rounded-full bg-white px-1.5 py-0.5 text-xs font-semibold text-gray-700">{column.count}</span>
                <span className="text-sm font-semibold text-black [writing-mode:vertical-rl]">{meta.label}</span>
              </button>
            );
          }
          const hasMore = column.cards.length < column.count;
          return (
            <section
              key={column.stage}
              {...dropProps}
              aria-label={meta.label}
              className={`flex max-h-[40rem] w-[85vw] shrink-0 snap-start flex-col rounded-xl border-t-4 transition-all duration-200 sm:w-[18.5rem] ${meta.column} ${dropTarget === column.stage ? "ring-2 ring-brand" : ""}`}
            >
              <header className="sticky top-0 z-10 flex items-start justify-between gap-2 p-3 pb-2">
                <div className="min-w-0">
                  <h3 className="flex items-center gap-2 font-semibold text-black">
                    <span className={`h-2 w-2 rounded-full ${meta.dot}`} aria-hidden />{meta.label}
                  </h3>
                  <p className="truncate text-xs text-black/60" title={meta.description}>{meta.description}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-gray-700">{column.count}</span>
                  <button type="button" onClick={() => toggle(column.stage)} title={`Recolher ${meta.label}`} aria-label={`Recolher coluna ${meta.label}`} aria-expanded
                    className="rounded p-1 text-black/50 hover:bg-white/60 hover:text-black">⟨</button>
                </div>
              </header>
              {(["NOVO", "EM_ATENDIMENTO", "FOLLOW_UP", "INATIVO"] as PipelineStage[]).includes(column.stage) && (
                <ColumnFilters
                  stage={column.stage}
                  value={column.filter ?? {}}
                  onChange={(filter) => applyColumnFilter(column.stage, filter)}
                  canSeeSeller={canSeeSeller}
                  currentUserId={currentUserId}
                  sellerOptions={sellerOptions}
                />
              )}
              <div className="flex-1 space-y-2 overflow-y-auto px-3 pb-3">
                {column.loading && <p className="text-center text-xs text-black/50">Carregando…</p>}
                {column.cards.map((card) => (
                  <Card
                    key={card.id}
                    card={card}
                    canSeeSeller={canSeeSeller}
                    isDragging={dragId === card.id}
                    menuOpen={menuFor === card.id}
                    onMenu={() => setMenuFor((current) => (current === card.id ? null : card.id))}
                    onDragStart={() => setDragId(card.id)}
                    onDragEnd={() => { setDragId(null); setDropTarget(null); }}
                    onContact={() => setModal({ kind: "contact", card })}
                    onMove={(to) => requestMove(card, to)}
                    onSchedule={() => { setMenuFor(null); setModal({ kind: "schedule", card }); }}
                  />
                ))}
                {!column.loading && column.cards.length === 0 && (
                  <p className="rounded-lg border border-dashed border-gray-300 p-5 text-center text-xs text-gray-400">Nenhum cliente nesta etapa.</p>
                )}
                {hasMore && !column.loading && (
                  <button type="button" className="w-full rounded-md bg-white/70 py-2 text-xs font-medium text-gray-700 hover:bg-white" onClick={() => loadMore(column.stage)}>
                    Carregar mais ({column.count - column.cards.length})
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {modal && (
        <ActionModal
          modal={modal}
          onClose={() => setModal(null)}
          onSubmit={async (url, body, optimisticStage) => {
            const ok = await send(url, body, modal.card, optimisticStage);
            if (ok) {
              setModal(null);
              setNotice({ text: modal.kind === "contact" ? `Contato registrado (${ok.attempts} no ciclo).` : "Alteração salva." });
            }
          }}
        />
      )}
    </div>
  );
}

function ColumnFilters({ stage, value, onChange, canSeeSeller, currentUserId, sellerOptions }: {
  stage: PipelineStage;
  value: Record<string, string>;
  onChange: (filter: Record<string, string>) => void;
  canSeeSeller: boolean;
  currentUserId: string;
  sellerOptions: UserOption[];
}) {
  const set = (key: string, next: string) => {
    const filter = { ...value };
    if (next) filter[key] = next; else delete filter[key];
    onChange(filter);
  };
  const chip = (active: boolean) => `rounded-full px-2 py-0.5 text-[11px] font-medium ${active ? "bg-gray-900 text-white" : "bg-white/80 text-gray-700 hover:bg-white"}`;
  const buckets: FollowUpBucket[] = ["OVERDUE", "TODAY", "TOMORROW", "WEEK", "NONE"];
  const isDailyStage = stage === "NOVO" || stage === "EM_ATENDIMENTO";
  const selectedDay = value.stageChangedFrom === value.stageChangedTo ? value.stageChangedFrom ?? "" : "";
  const setDay = (day: string) => onChange({
    ...value,
    ...(day ? { stageChangedFrom: day, stageChangedTo: day } : {}),
    ...(!day ? { stageChangedFrom: "", stageChangedTo: "" } : {}),
  });
  return (
    <div className="space-y-1.5 px-3 pb-2">
      {isDailyStage && (
        <div className="space-y-1.5 rounded-md bg-white/45 p-2">
          <div className="flex flex-wrap gap-1" aria-label={`Filtrar ${PIPELINE_STAGE_META[stage].label.toLowerCase()} por dia`}>
            <button type="button" className={chip(!selectedDay)} onClick={() => setDay("")}>Geral</button>
            <button type="button" className={chip(selectedDay === brazilDateKey(new Date()))} onClick={() => setDay(brazilDateKey(new Date()))}>
              {stage === "NOVO" ? "Novos do dia" : "Atendimentos do dia"}
            </button>
            <input type="date" aria-label={`Data de ${PIPELINE_STAGE_META[stage].label}`} className="rounded border border-gray-200 bg-white px-1 py-0.5 text-[11px]" value={selectedDay} onChange={(event) => setDay(event.target.value)} />
          </div>
          {canSeeSeller && (
            <UserCombobox options={sellerOptions} value={value.sellerId ?? ""} emptyLabel="Todos os funcionários" ariaLabel={`Filtrar ${PIPELINE_STAGE_META[stage].label.toLowerCase()} por funcionário`} onChange={(id) => set("sellerId", id)} />
          )}
        </div>
      )}
      {stage === "FOLLOW_UP" && (
        <div className="flex flex-wrap gap-1" aria-label="Filtrar follow-up por data">
          {buckets.map((bucket) => (
            <button key={bucket} type="button" className={chip(value.followUp === bucket)} onClick={() => set("followUp", value.followUp === bucket ? "" : bucket)}>
              {FOLLOW_UP_BUCKET_LABELS[bucket]}
            </button>
          ))}
        </div>
      )}
      {stage === "INATIVO" && (
        <div className="flex flex-wrap items-center gap-1">
          <button type="button" className={chip(value.sellerId === currentUserId)} onClick={() => set("sellerId", value.sellerId === currentUserId ? "" : currentUserId)}>Meus inativos</button>
          <input type="date" aria-label="Inativos desde" title="Inativos desde" className="rounded border border-gray-200 bg-white px-1 py-0.5 text-[11px]" value={value.stageChangedFrom ?? ""} onChange={(event) => set("stageChangedFrom", event.target.value)} />
          <input type="date" aria-label="Inativos até" title="Inativos até" className="rounded border border-gray-200 bg-white px-1 py-0.5 text-[11px]" value={value.stageChangedTo ?? ""} onChange={(event) => set("stageChangedTo", event.target.value)} />
        </div>
      )}
      {stage === "INATIVO" && canSeeSeller && (
        <div className="text-xs">
          <UserCombobox options={sellerOptions} value={value.sellerId ?? ""} emptyLabel="Todos os vendedores" ariaLabel="Filtrar inativos por vendedor" onChange={(id) => set("sellerId", id)} />
        </div>
      )}
      <div className="flex flex-wrap gap-1" aria-label="Filtrar por tentativas">
        {["1", "2", "3"].map((attempts) => (
          <button key={attempts} type="button" className={chip(value.attempts === attempts)} onClick={() => set("attempts", value.attempts === attempts ? "" : attempts)}>
            {"★".repeat(Number(attempts))} {attempts === "3" ? "3+" : attempts}
          </button>
        ))}
      </div>
    </div>
  );
}

function Card({ card, canSeeSeller, isDragging, menuOpen, onMenu, onDragStart, onDragEnd, onContact, onMove, onSchedule }: {
  card: PipelineCardDto;
  canSeeSeller: boolean;
  isDragging: boolean;
  menuOpen: boolean;
  onMenu: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onContact: () => void;
  onMove: (to: PipelineStage) => void;
  onSchedule: () => void;
}) {
  const paused = card.stage === "RECICLAGEM" || card.stage === "INATIVO";
  const decide = needsAttemptDecision(card.attempts, card.stage);
  const overdue = card.nextActionAt ? followUpBucket(new Date(card.nextActionAt)) === "OVERDUE" : false;
  return (
    <article
      draggable
      onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", card.id); onDragStart(); }}
      onDragEnd={onDragEnd}
      className={`relative rounded-lg border bg-white p-3 text-xs shadow-sm transition-[transform,opacity,box-shadow] duration-200 ease-out ${isDragging ? "scale-[0.98] opacity-45 shadow-none" : "scale-100 opacity-100"} ${card.repurchase ? "border-purple-300" : "border-gray-100"} ${decide ? "ring-1 ring-amber-300" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/clientes/${card.id}`} className="block truncate text-sm font-semibold text-gray-900 hover:text-brand">{card.name}</Link>
          {card.company && <p className="truncate text-gray-500">{card.company}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {card.repurchase && <span className="rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700" title="Cliente já comprou anteriormente">RECOMPRA</span>}
          <button type="button" aria-label={`Ações de ${card.name}`} className="rounded px-1 text-base leading-none text-gray-400 hover:bg-gray-100 hover:text-gray-700" onClick={onMenu}>⋯</button>
        </div>
      </div>

      <p className="mt-1.5 truncate text-gray-600">
        {canSeeSeller ? card.seller.name : "Responsável: você"}
        {card.seller.rca && <span className="ml-1 text-gray-400">· RCA {card.seller.rca}</span>}
      </p>

      {card.stage === "COTACAO" && card.quote && (
        <p className="mt-1 font-medium text-gray-800">Cotação · {card.quote.valueCents ? money(card.quote.valueCents) : "sem valor"} <span className="font-normal text-gray-400">· {shortDate(card.quote.createdAt)}</span></p>
      )}
      {card.stage === "VENDIDO" && card.sale && (
        <p className="mt-1 font-medium text-gray-800">
          {card.sale.orderNumber ? `Pedido #${card.sale.orderNumber}` : "Pedido"} · {money(card.sale.valueCents)}
          {card.sale.commissionRateBps !== null && <span className="font-normal text-gray-500"> · Comissão {formatCommissionPercent(card.sale.commissionRateBps)}</span>}
        </p>
      )}
      {card.stage !== "COTACAO" && card.stage !== "VENDIDO" && card.totalSoldCents > 0 && <p className="mt-1 text-gray-700">{money(card.totalSoldCents)} vendidos</p>}

      <div className="mt-2 flex items-center justify-between gap-2">
        <Stars attempts={card.attempts} />
        <span className="text-gray-400">{TEMPERATURE_LABELS[card.temperature] ?? card.temperature}</span>
      </div>

      <div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-0.5 text-gray-500">
        {card.stage === "NOVO" ? (
          <>
            <span className="truncate" title="Origem">{card.origin || "Sem origem"}</span>
            <span className="text-right" title="Data de entrada">Entrada {shortDate(card.createdAt)}</span>
            <span className="col-span-2 truncate">{card.phoneDigits || card.email || "Sem contato"}{card.location ? ` · ${card.location}` : ""}</span>
          </>
        ) : (
          <>
            <span>Último contato: {shortDate(card.lastInteractionAt)}</span>
            <span className={`text-right ${overdue ? "font-semibold text-red-600" : ""}`}>Próx.: {shortDate(card.nextActionAt)}</span>
          </>
        )}
      </div>

      {card.stageReason && paused && <p className="mt-1.5 truncate text-gray-500" title={card.stageReason}>Motivo: {card.stageReason}</p>}
      {card.returnAt && (
        <p className="mt-1 text-indigo-700">Volta para {PIPELINE_STAGE_META[card.returnTo ?? "NOVO"].label} em {shortDate(card.returnAt)}</p>
      )}

      {decide && (
        <div className="mt-2 rounded-md bg-amber-50 p-2">
          <p className="font-medium text-amber-800">3 tentativas sem sucesso — decidir:</p>
          <div className="mt-1 flex flex-wrap gap-1">
            <button type="button" className="rounded bg-white px-2 py-0.5 text-purple-700 hover:bg-purple-50" onClick={() => onMove("RECICLAGEM")}>Reciclagem</button>
            <button type="button" className="rounded bg-white px-2 py-0.5 text-gray-700 hover:bg-gray-100" onClick={() => onMove("INATIVO")}>Inativo</button>
          </div>
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-1">
        {!paused && <button type="button" className="rounded-md bg-gray-900 px-2 py-1 text-[11px] font-medium text-white hover:bg-gray-700" onClick={onContact}>Registrar contato</button>}
        {card.stage === "RECICLAGEM" && <button type="button" className="rounded-md border px-2 py-1 text-[11px] hover:bg-gray-50" onClick={() => onMove("EM_ATENDIMENTO")}>Voltar para atendimento</button>}
        {card.stage === "RECICLAGEM" && <button type="button" className="rounded-md border px-2 py-1 text-[11px] hover:bg-gray-50" onClick={() => onMove("INATIVO")}>Enviar para inativos</button>}
        {card.stage === "INATIVO" && <button type="button" className="rounded-md border px-2 py-1 text-[11px] hover:bg-gray-50" onClick={() => onMove("NOVO")}>Reativar</button>}
        {card.stage === "EM_ATENDIMENTO" && <Link href={`/clientes/${card.id}#criar-proposta`} className="rounded-md border px-2 py-1 text-[11px] hover:bg-gray-50">Criar cotação</Link>}
        {card.stage === "COTACAO" && card.quote && <Link href={`/cotacoes/${card.quote.id}`} className="rounded-md border px-2 py-1 text-[11px] hover:bg-gray-50">Atualizar cotação</Link>}
      </div>

      {menuOpen && (
        <div className="absolute right-2 top-8 z-30 w-52 rounded-md border border-gray-200 bg-white py-1 text-xs shadow-lg" role="menu">
          <p className="px-3 py-1 text-[10px] uppercase tracking-wide text-gray-400">Mover para</p>
          {PIPELINE_STAGES.filter((stage) => stage !== "VENDIDO" &&
            stage !== card.stage
            && (card.stage !== "RECICLAGEM" || stage === "EM_ATENDIMENTO" || stage === "INATIVO")
            && (!decide || stage === "RECICLAGEM" || stage === "INATIVO")
          ).map((stage) => (
            <button key={stage} type="button" role="menuitem" className="block w-full px-3 py-1.5 text-left hover:bg-gray-50" onClick={() => onMove(stage)}>
              {stage === "INATIVO" ? "Marcar como Inativo" : stage === "VENDIDO" ? "Marcar como Vendido" : PIPELINE_STAGE_META[stage].label}
            </button>
          ))}
          <div className="my-1 border-t" />
          <button type="button" role="menuitem" className="block w-full px-3 py-1.5 text-left hover:bg-gray-50" onClick={onSchedule}>
            {card.returnAt ? "Alterar/cancelar retorno" : "Voltar para Novos em…"}
          </button>
        </div>
      )}
    </article>
  );
}

function ReturnPicker({ option, setOption, date, setDate, allowNone }: { option: string; setOption: (value: string) => void; date: string; setDate: (value: string) => void; allowNone?: boolean }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {allowNone && <button type="button" className={`rounded-full px-2.5 py-1 text-xs ${option === "" ? "bg-gray-900 text-white" : "bg-gray-100"}`} onClick={() => setOption("")}>Sem data</button>}
        {RETURN_OPTIONS.map((item) => (
          <button key={item.key} type="button" className={`rounded-full px-2.5 py-1 text-xs ${option === item.key ? "bg-gray-900 text-white" : "bg-gray-100"}`} onClick={() => setOption(item.key)}>{item.label}</button>
        ))}
      </div>
      {option === "custom" && <input type="date" aria-label="Data personalizada" className="input-field" value={date} onChange={(event) => setDate(event.target.value)} />}
    </div>
  );
}

export function ActionModal({ modal, onClose, onSubmit }: {
  modal: Modal;
  onClose: () => void;
  onSubmit: (url: string, body: unknown, optimisticStage?: PipelineStage) => Promise<void>;
}) {
  const [channel, setChannel] = useState("WHATSAPP");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [reasonDetail, setReasonDetail] = useState("");
  const [option, setOption] = useState(modal.kind === "schedule" ? "7" : "");
  const [date, setDate] = useState("");
  const [returnTo, setReturnTo] = useState<"NOVO" | "FOLLOW_UP" | "EM_ATENDIMENTO">(
    modal.kind === "move" && modal.to === "RECICLAGEM" ? "EM_ATENDIMENTO" : "NOVO"
  );
  const [busy, setBusy] = useState(false);
  const to = modal.kind === "move" ? modal.to : null;
  const url = modal.kind === "contact" ? `/api/customers/${modal.card.id}/contact-attempts` : `/api/customers/${modal.card.id}/stage`;
  const finalReason = reason === "Outro" ? (reasonDetail.trim() ? `Outro: ${reasonDetail.trim()}` : "") : reason;

  const title = modal.kind === "contact" ? `Registrar contato — tentativa ${modal.card.attempts + 1}`
    : modal.kind === "schedule" ? "Voltar em…"
    : to === "INATIVO" ? "Marcar como Inativo" : to === "VENDIDO" ? "Marcar como Vendido" : `Mover para ${PIPELINE_STAGE_META[to!].label}`;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    if (modal.kind === "contact") await onSubmit(url, { channel, note: note || null });
    else if (modal.kind === "schedule") await onSubmit(url, option === "none" ? { action: "CANCEL_RETURN" } : { action: "SCHEDULE_RETURN", returnOption: option, customDate: date || null, returnTo });
    else if (to === "NOVO" && option) await onSubmit(url, { action: "SCHEDULE_RETURN", returnOption: option, customDate: date || null, returnTo: "NOVO" });
    else if (to === "VENDIDO") {
      setBusy(false);
      return;
    } else {
      await onSubmit(url, {
        action: "MOVE", to, reason: finalReason || null,
        ...(to === "RECICLAGEM" ? { returnOption: option || null, customDate: date || null, returnTo } : {}),
        ...(to === "FOLLOW_UP" ? { followUpOption: option || null, followUpDate: date || null, followUpNote: note || null } : {}),
      }, to!);
    }
    setBusy(false);
  }

  const reasonRequired = to === "INATIVO" || to === "RECICLAGEM";
  const invalid = (reasonRequired && !finalReason) || (option === "custom" && !date)
    || to === "VENDIDO"
    || (modal.kind === "schedule" && !option);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(event) => event.stopPropagation()} className="w-full max-w-md space-y-3 rounded-t-xl bg-white p-5 shadow-xl sm:rounded-xl" role="dialog" aria-modal aria-label={title}>
        <div>
          <h2 className="font-semibold text-gray-900">{title}</h2>
          <p className="text-xs text-gray-500">{modal.card.name}</p>
        </div>

        {modal.kind === "contact" && (
          <>
            <label className="block text-sm">Canal
              <select className="input-field mt-1" value={channel} onChange={(event) => setChannel(event.target.value)}>
                {CHANNELS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
            <label className="block text-sm">Observação (opcional)
              <textarea className="input-field mt-1" rows={3} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
            </label>
            <p className="text-xs text-gray-500">Etapa atual: {PIPELINE_STAGE_META[modal.card.stage].label}. {modal.card.stage === "NOVO" ? "O cliente vai para Em atendimento." : ""}</p>
          </>
        )}

        {reasonRequired && (
          <label className="block text-sm">Motivo *
            <select className="input-field mt-1" value={reason} onChange={(event) => setReason(event.target.value)} required>
              <option value="">Selecione…</option>
              {(to === "INATIVO" ? INACTIVE_REASONS : RECYCLE_REASONS).map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            {reason === "Outro" && <input className="input-field mt-2" placeholder="Descreva o motivo" maxLength={300} value={reasonDetail} onChange={(event) => setReasonDetail(event.target.value)} />}
          </label>
        )}

        {to === "RECICLAGEM" && (
          <>
            <div className="text-sm">Data de retorno (opcional)<div className="mt-1"><ReturnPicker option={option} setOption={setOption} date={date} setDate={setDate} allowNone /></div></div>
            {option && (
              <label className="block text-sm">Voltar para
                <select className="input-field mt-1" value={returnTo} onChange={(event) => setReturnTo(event.target.value as "EM_ATENDIMENTO")}>
                  <option value="EM_ATENDIMENTO">Em atendimento</option>
                </select>
              </label>
            )}
          </>
        )}

        {to === "FOLLOW_UP" && (
          <>
            <div className="text-sm">Próximo contato<div className="mt-1"><ReturnPicker option={option} setOption={setOption} date={date} setDate={setDate} allowNone /></div></div>
            <label className="block text-sm">Observação (opcional)
              <input className="input-field mt-1" maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
            </label>
          </>
        )}

        {to === "NOVO" && (
          <div className="text-sm">Quando?
            <div className="mt-1"><ReturnPicker option={option} setOption={setOption} date={date} setDate={setDate} allowNone /></div>
            <p className="mt-1 text-xs text-gray-500">{option ? "O cliente permanece na etapa atual e volta para Novos na data escolhida (novo ciclo)." : "Sem data: volta para Novos agora e inicia um novo ciclo."}</p>
          </div>
        )}

        {modal.kind === "schedule" && (
          <>
            <ReturnPicker option={option} setOption={setOption} date={date} setDate={setDate} />
            <label className="block text-sm">Voltar para
              <select className="input-field mt-1" value={returnTo} onChange={(event) => setReturnTo(event.target.value as "NOVO" | "FOLLOW_UP" | "EM_ATENDIMENTO")}>
                <option value="NOVO">Novos</option><option value="FOLLOW_UP">Follow-up</option><option value="EM_ATENDIMENTO">Em atendimento</option>
              </select>
            </label>
            {modal.card.returnAt && <button type="button" className="text-xs text-red-600 underline" onClick={() => setOption("none")}>Cancelar retorno agendado</button>}
          </>
        )}

        {to === "VENDIDO" && <p className="text-sm">Vendidos é atualizado somente após aprovação na Olist.</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn-primary" disabled={busy || invalid}>{busy ? "Salvando…" : "Confirmar"}</button>
        </div>
      </form>
    </div>
  );
}
