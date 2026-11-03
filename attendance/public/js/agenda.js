// Agenda e Follow-ups — só apresentação. Escopo (empresa, Supervisor/equipe,
// Master), Financeiro protegido e permissões de edição vêm do backend
// (follow-up-service). Datas exibidas sempre no fuso da operação.
const $ = (selector) => document.querySelector(selector);
const esc = (value = "") => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const TIME_ZONE = "America/Sao_Paulo";

const REASONS = {
  RETORNO_COMERCIAL: "Retorno comercial", COTACAO: "Cotação", NEGOCIACAO: "Negociação", POS_VENDA: "Pós-venda",
  AGUARDAR_CLIENTE: "Aguardar cliente", AGUARDAR_DOCUMENTO: "Aguardar documento", OUTRO: "Outro",
};
const PRIORITY_LABELS = { NORMAL: "Normal", ALTA: "Alta", URGENTE: "Urgente" };
const STATE_LABELS = { PENDENTE: "Pendente", ATRASADO: "Atrasado", CONCLUIDO: "Concluído", CANCELADO: "Cancelado" };
const BUCKETS = [
  ["PENDING", "Todos pendentes", ""],
  ["OVERDUE", "Atrasados", "critical"],
  ["TODAY", "Hoje", "warning"],
  ["TOMORROW", "Amanhã", ""],
  ["WEEK", "Esta semana", ""],
  ["UPCOMING", "Próximos", ""],
  ["DONE", "Concluídos", ""],
  ["CANCELLED", "Cancelados", ""],
];

const state = { mode: "list", bucket: "PENDING", company: "ALL", anchor: null, user: null, loading: false, pending: false, counts: {} };

async function api(url, options = {}) {
  const headers = { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) };
  const response = await fetch(url, { ...options, headers, credentials: "same-origin" });
  if (response.status === 401) { location.replace("/login.html"); throw new Error("Sessão encerrada."); }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body?.error || "Não foi possível concluir a operação."), { status: response.status });
  return body;
}

function toast(message, error = false) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.toggle("error", error);
  element.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("show"), 3200);
}

// ---- datas no fuso da operação ------------------------------------------------
const keyFormat = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const timeFormat = new Intl.DateTimeFormat("pt-BR", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" });
const fullFormat = new Intl.DateTimeFormat("pt-BR", { timeZone: TIME_ZONE, weekday: "long", day: "2-digit", month: "long" });
const dayKey = (date) => keyFormat.format(new Date(date));
const timeOf = (date) => timeFormat.format(new Date(date));
// Data "civil" (sem fuso) para montar grades de calendário.
const civil = (key) => { const [y, m, d] = key.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const civilKey = (date) => date.toISOString().slice(0, 10);
const addDays = (key, days) => { const date = civil(key); date.setUTCDate(date.getUTCDate() + days); return civilKey(date); };
const weekday = (key) => (civil(key).getUTCDay() + 6) % 7; // 0 = segunda
const civilLabel = (key, options) => { const text = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", ...options }).format(civil(key)); return text.charAt(0).toUpperCase() + text.slice(1); };
const todayKey = () => dayKey(new Date());

function rangeFor(mode, anchor) {
  if (mode === "day") return { from: anchor, to: anchor, label: civilLabel(anchor, { weekday: "long", day: "2-digit", month: "long" }) };
  if (mode === "week") {
    const from = addDays(anchor, -weekday(anchor));
    const to = addDays(from, 6);
    return { from, to, label: `${civilLabel(from, { day: "2-digit", month: "short" })} – ${civilLabel(to, { day: "2-digit", month: "short", year: "numeric" })}` };
  }
  const first = `${anchor.slice(0, 7)}-01`;
  const gridFrom = addDays(first, -weekday(first));
  const nextMonth = civil(first); nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const last = addDays(civilKey(nextMonth), -1);
  const gridTo = addDays(last, 6 - weekday(last));
  return { from: gridFrom, to: gridTo, monthFrom: first, monthTo: last, label: civilLabel(first, { month: "long", year: "numeric" }) };
}

// ---- renderização ---------------------------------------------------------------
function companyBadge(company) {
  return window.CompanyContext?.multi() ? window.CompanyContext.badge(company) : "";
}
const styleAttr = (company) => window.CompanyContext?.styleAttr(company) || "";

function itemMarkup(item) {
  const showDate = state.mode === "list";
  return `
    <button type="button" class="ag-item ${esc(item.state)}" data-follow-up="${esc(item.id)}"${styleAttr(item.company)}>
      <span class="ag-time">${esc(timeOf(item.dueAt))}${showDate ? `<small>${esc(civilLabel(dayKey(item.dueAt), { day: "2-digit", month: "2-digit" }))}</small>` : ""}</span>
      <span class="ag-main">
        <span class="ag-main-line"><strong>${esc(item.contact.name)}</strong>${companyBadge(item.company)}</span>
        <span class="ag-meta">
          <b>${esc(item.reasonLabel)}</b>
          <span>${item.assignee ? `Responsável: ${esc(item.assignee.name)}${item.isPreferredAssignee ? " ★" : ""}` : "Sem responsável"}</span>
          ${item.channelAccount ? `<span>${esc(item.channelAccount.name)}</span>` : ""}
          ${item.priority !== "NORMAL" ? `<span class="ag-pill prio-${esc(item.priority)}">${esc(PRIORITY_LABELS[item.priority])}</span>` : ""}
          ${item.privateSector ? `<span>🔒 ${esc(item.privateSector)}</span>` : ""}
          ${item.rescheduleCount ? `<span>Reagendado ${item.rescheduleCount}×</span>` : ""}
        </span>
        ${item.note ? `<span class="ag-note-preview">${esc(item.note)}</span>` : ""}
      </span>
      <span class="ag-pill ${esc(item.state)}">${esc(STATE_LABELS[item.state] || item.state)}</span>
    </button>`;
}

function renderBuckets(counts) {
  state.counts = counts;
  const pending = (counts.OVERDUE || 0) + (counts.UPCOMING || 0);
  $("#ag-buckets").hidden = state.mode !== "list";
  $("#ag-buckets").innerHTML = BUCKETS.map(([key, label, tone]) => {
    const value = key === "PENDING" ? pending : Number(counts[key] || 0);
    return `<button type="button" class="ag-bucket ${tone} ${value ? "" : "zero"} ${state.bucket === key ? "active" : ""}" data-bucket="${key}" aria-pressed="${state.bucket === key}"><span>${esc(label)}</span><strong>${value}</strong></button>`;
  }).join("");
}

function renderList(items) {
  if (!items.length) {
    $("#ag-content").innerHTML = `<div class="ag-empty">${state.bucket === "OVERDUE" ? "Nenhum retorno atrasado. 🎉" : "Nenhum retorno neste filtro."}</div>`;
    return;
  }
  const groups = new Map();
  const today = todayKey();
  for (const item of items) {
    const key = ["DONE", "CANCELLED"].includes(state.bucket) ? dayKey(item.completedAt || item.cancelledAt || item.dueAt)
      : item.state === "ATRASADO" ? "OVERDUE" : dayKey(item.dueAt);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  $("#ag-content").innerHTML = [...groups.entries()].map(([key, group]) => {
    const title = key === "OVERDUE" ? "Atrasados" : key === today ? "Hoje" : key === addDays(today, 1) ? "Amanhã" : civilLabel(key, { weekday: "long", day: "2-digit", month: "long" });
    return `<section class="ag-group"><h2>${esc(title)} · ${group.length}</h2><div class="ag-list">${group.map(itemMarkup).join("")}</div></section>`;
  }).join("");
}

function renderDay(items) {
  $("#ag-content").innerHTML = items.length
    ? `<div class="ag-list">${items.map(itemMarkup).join("")}</div>`
    : `<div class="ag-empty">Nenhum retorno neste dia.</div>`;
}

function chip(item) {
  return `<button type="button" class="ag-chip ${esc(item.state)}" data-follow-up="${esc(item.id)}"${styleAttr(item.company)} title="${esc(`${timeOf(item.dueAt)} · ${item.contact.name} · ${item.reasonLabel}`)}">${esc(timeOf(item.dueAt))} ${esc(item.contact.name)}</button>`;
}

function renderGrid(items, range, { month = false } = {}) {
  const byDay = new Map();
  for (const item of items) {
    const key = dayKey(item.dueAt);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(item);
  }
  const today = todayKey();
  const cells = [];
  for (let key = range.from; key <= range.to; key = addDays(key, 1)) {
    const dayItems = byDay.get(key) || [];
    const max = month ? 3 : 50;
    const outside = month && (key < range.monthFrom || key > range.monthTo);
    cells.push(`<div class="ag-day ${key === today ? "today" : ""} ${outside ? "outside" : ""} ${dayItems.length ? "has-items" : ""}" data-count="${dayItems.length}">
      <div class="ag-day-head"><span>${month ? "" : esc(civilLabel(key, { weekday: "short" }))}</span><b>${esc(civilLabel(key, { day: "2-digit" }))}</b></div>
      ${dayItems.slice(0, max).map(chip).join("")}
      ${dayItems.length > max ? `<button type="button" class="ag-more" data-goto-day="${key}">+${dayItems.length - max} mais</button>` : ""}
    </div>`);
  }
  const head = month ? ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"].map((day) => `<div class="ag-weekday">${day}</div>`).join("") : "";
  $("#ag-content").innerHTML = `<div class="${month ? "ag-month" : "ag-week"}">${head}${cells.join("")}</div>`;
}

// ---- carregamento -------------------------------------------------------------
function baseParams() {
  const params = new URLSearchParams();
  if (state.company && state.company !== "ALL") params.set("company", state.company);
  for (const [key, selector] of [["assigneeId", "#ag-assignee"], ["reason", "#ag-reason"], ["priority", "#ag-priority"]]) {
    if ($(selector).value) params.set(key, $(selector).value);
  }
  return params;
}

async function load() {
  if (state.loading) { state.pending = true; return; }
  state.loading = true;
  try {
    const params = baseParams();
    let range = null;
    if (state.mode === "list") {
      params.set("view", state.bucket);
    } else {
      range = rangeFor(state.mode, state.anchor);
      params.set("view", "ALL");
      params.set("from", range.from);
      params.set("to", range.to);
      params.set("limit", "500");
      $("#ag-range-label").textContent = range.label;
    }
    const data = await api(`/api/follow-ups?${params}`);
    renderBuckets(data.counts);
    $("#ag-truncated").hidden = !data.truncated;
    if (state.mode === "list") renderList(data.items);
    else if (state.mode === "day") renderDay(data.items);
    else renderGrid(data.items, range, { month: state.mode === "month" });
    $("#ag-updated").textContent = `Atualizado às ${new Intl.DateTimeFormat("pt-BR", { timeStyle: "short" }).format(new Date())}`;
  } catch (error) {
    toast(error.message, true);
  } finally {
    state.loading = false;
    if (state.pending) { state.pending = false; load(); }
  }
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
    button.setAttribute("aria-selected", String(button.dataset.mode === mode));
  });
  $("#ag-nav").hidden = mode === "list";
  try { localStorage.setItem("mibro-agenda-mode", mode); } catch { /* ignore */ }
  load();
}

function shiftAnchor(direction) {
  if (state.mode === "day") state.anchor = addDays(state.anchor, direction);
  else if (state.mode === "week") state.anchor = addDays(state.anchor, 7 * direction);
  else {
    const date = civil(`${state.anchor.slice(0, 7)}-01`);
    date.setUTCMonth(date.getUTCMonth() + direction);
    state.anchor = civilKey(date);
  }
  load();
}

// ---- detalhe e ações -------------------------------------------------------------
function windowMarkup(window) {
  if (!window) return "";
  if (window.open) return `<div class="ag-window">Janela de 24h <b>aberta</b> neste número${window.expiresAt ? ` até ${esc(new Intl.DateTimeFormat("pt-BR", { timeZone: TIME_ZONE, dateStyle: "short", timeStyle: "short" }).format(new Date(window.expiresAt)))}` : ""}: mensagem comum permitida (conforme suas permissões).</div>`;
  if (!window.configured) return `<div class="ag-window">Sem informação de janela para este número.</div>`;
  return `<div class="ag-window closed">Janela de 24h <b>fechada</b> neste número: para retomar o contato pelo WhatsApp é preciso um <b>template aprovado</b>. A janela de outro número não vale para este.</div>`;
}

async function openDetail(id) {
  const dialog = $("#ag-dialog");
  $("#ag-dialog-body").innerHTML = `<div class="ag-empty">Carregando…</div>`;
  if (!dialog.open) dialog.showModal();
  try {
    const item = await api(`/api/follow-ups/${encodeURIComponent(id)}`);
    let options = null;
    if (item.canEdit) options = await api(`/api/follow-ups/options?followUpId=${encodeURIComponent(id)}`).catch(() => null);
    renderDetail(item, options);
  } catch (error) {
    $("#ag-dialog-body").innerHTML = `<div class="ag-empty">${esc(error.status === 404 ? "Retorno não encontrado ou sem acesso." : error.message)}</div>`;
  }
}

function renderDetail(item, options) {
  $("#ag-dialog-title").innerHTML = `${esc(item.contact.name)} ${companyBadge(item.company)}`;
  $("#ag-dialog-kicker").textContent = `RETORNO · ${STATE_LABELS[item.state] || item.state}`.toUpperCase();
  const due = new Intl.DateTimeFormat("pt-BR", { timeZone: TIME_ZONE, dateStyle: "full", timeStyle: "short" }).format(new Date(item.dueAt));
  const rows = [
    ["Quando", due, item.state === "ATRASADO"],
    ["Motivo", item.reasonLabel],
    ["Prioridade", PRIORITY_LABELS[item.priority] || item.priority],
    ["Responsável", item.assignee ? `${item.assignee.name}${item.isPreferredAssignee ? " (atendente fixo)" : ""}` : "Sem responsável"],
    ["Empresa", item.company?.name || "—"],
    ["Número/canal", item.channelAccount ? `${item.channelAccount.name}${item.channelAccount.displayNumber ? ` · ${item.channelAccount.displayNumber}` : ""}` : "—"],
    ["Criado por", `${item.createdBy?.name || (item.source === "FLOW" ? "Fluxo do Bot" : "—")}`],
    ...(item.rescheduleCount ? [["Reagendamentos", String(item.rescheduleCount)]] : []),
    ...(item.status === "CANCELADO" && item.cancelReason ? [["Motivo do cancelamento", item.cancelReason]] : []),
  ];
  const assigneeOptions = options?.assignees?.length
    ? options.assignees.map((user) => `<option value="${esc(user.id)}" ${user.id === item.assignee?.id ? "selected" : ""}>${esc(user.name)}${user.id === options.preferredAssigneeId ? " ★ atendente fixo" : ""}</option>`).join("")
    : "";
  const dueKey = dayKey(item.dueAt);
  const dueTime = timeOf(item.dueAt);
  $("#ag-dialog-body").innerHTML = `
    <div class="ag-rows">${rows.map(([label, value, alert]) => `<div class="ag-row ${alert ? "alert" : ""}"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join("")}</div>
    ${item.restricted ? `<div class="ag-note-box restricted">🔒 Observação de setor protegido (${esc(item.privateSector || "restrito")}).</div>` : item.note ? `<div class="ag-note-box">${esc(item.note)}</div>` : ""}
    ${windowMarkup(item.customerServiceWindow)}
    <div class="ag-actions">
      ${item.canOpenConversation ? `<a href="/?conversation=${encodeURIComponent(item.conversationId)}">Abrir conversa</a>` : ""}
    </div>
    ${item.canEdit ? `
    <form class="ag-form" id="ag-edit-form">
      <h3>Reagendar / editar</h3>
      <div class="ag-form-grid">
        <label>Data<input type="date" name="date" value="${esc(dueKey)}" required></label>
        <label>Horário<input type="time" name="time" value="${esc(dueTime)}" required></label>
        <label>Motivo<select name="reason">${Object.entries(REASONS).map(([value, label]) => `<option value="${value}" ${value === item.reason ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></label>
        <label>Prioridade<select name="priority">${Object.entries(PRIORITY_LABELS).map(([value, label]) => `<option value="${value}" ${value === item.priority ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></label>
        ${assigneeOptions ? `<label>Responsável<select name="assigneeId">${assigneeOptions}</select></label>` : ""}
      </div>
      ${item.restricted ? "" : `<label>Observação<textarea name="note" maxlength="2000">${esc(item.note || "")}</textarea></label>`}
      <div class="ag-actions"><button type="submit" class="primary">Salvar alterações</button></div>
    </form>
    <form class="ag-form" id="ag-finish-form">
      <h3>Encerrar</h3>
      <label>Comentário (opcional)<input name="comment" maxlength="500" placeholder="Ex.: cliente confirmou o pedido"></label>
      <div class="ag-actions"><button type="button" class="danger" data-finish="cancel">Cancelar retorno</button><button type="button" class="primary" data-finish="complete">Concluir</button></div>
    </form>` : ""}`;
  const editForm = $("#ag-edit-form");
  editForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(editForm);
    const body = { reason: form.get("reason"), priority: form.get("priority") };
    if (form.get("date") !== dueKey || form.get("time") !== dueTime) Object.assign(body, { date: form.get("date"), time: form.get("time") });
    if (form.has("assigneeId")) body.assigneeId = form.get("assigneeId");
    if (form.has("note")) body.note = form.get("note");
    try {
      const updated = await api(`/api/follow-ups/${encodeURIComponent(item.id)}`, { method: "PATCH", body: JSON.stringify(body) });
      toast("Retorno atualizado.");
      renderDetail(updated, options);
      load();
    } catch (error) { toast(error.message, true); }
  });
  $("#ag-finish-form")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-finish]");
    if (!button) return;
    const comment = new FormData($("#ag-finish-form")).get("comment");
    const action = button.dataset.finish;
    try {
      const updated = await api(`/api/follow-ups/${encodeURIComponent(item.id)}/${action}`, { method: "POST", body: JSON.stringify(action === "complete" ? { note: comment } : { reason: comment }) });
      toast(action === "complete" ? "Retorno concluído." : "Retorno cancelado.");
      renderDetail(updated, null);
      load();
    } catch (error) { toast(error.message, true); }
  });
}

// ---- eventos ----------------------------------------------------------------------
$("#ag-content").addEventListener("click", (event) => {
  const more = event.target.closest("[data-goto-day]");
  if (more) { state.anchor = more.dataset.gotoDay; setMode("day"); return; }
  const target = event.target.closest("[data-follow-up]");
  if (target) openDetail(target.dataset.followUp);
});
$("#ag-buckets").addEventListener("click", (event) => {
  const button = event.target.closest("[data-bucket]");
  if (!button) return;
  state.bucket = button.dataset.bucket;
  load();
});
document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
$("#ag-prev").addEventListener("click", () => shiftAnchor(-1));
$("#ag-next").addEventListener("click", () => shiftAnchor(1));
$("#ag-today").addEventListener("click", () => { state.anchor = todayKey(); load(); });
$("#ag-filters").addEventListener("change", load);
$("#ag-refresh").addEventListener("click", load);
$("#ag-dialog-close").addEventListener("click", () => $("#ag-dialog").close());
$("#ag-dialog").addEventListener("click", (event) => { if (event.target === $("#ag-dialog")) $("#ag-dialog").close(); });
$("#theme-toggle").addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme !== "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  try { localStorage.setItem("mibro-theme", dark ? "dark" : "light"); } catch { /* ignore */ }
});
$("#logout").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" });
  location.replace("/login.html");
});

// Atualização: avisos do SSE (sem conteúdo) com debounce + rede de segurança
// a cada 60 s (retornos da equipe não geram aviso direcionado ao Supervisor).
function listenRealtime() {
  let timer;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(load, 800); };
  try {
    const events = new EventSource("/api/events");
    events.addEventListener("followup.updated", schedule);
    events.addEventListener("followup.reminder", (event) => {
      schedule();
      let kind = "";
      try { kind = JSON.parse(event.data).kind; } catch { /* ignore */ }
      toast(kind === "OVERDUE" ? "Você tem um retorno atrasado." : kind === "CUSTOMER_RETURNED" ? "Um cliente com retorno pendente enviou mensagem." : "Você tem um retorno próximo.");
    });
  } catch { /* sem SSE: só o intervalo */ }
  setInterval(() => { if (!document.hidden) load(); }, 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
}

(async () => {
  try {
    const status = await api("/api/auth/status");
    state.user = status.user;
    $("#current-user").textContent = status.user.name;
    $("#ag-reason").innerHTML += Object.entries(REASONS).map(([value, label]) => `<option value="${value}">${esc(label)}</option>`).join("");
    await window.CompanyContext.load();
    state.company = window.CompanyContext.preference || "ALL";
    window.CompanyContext.mountFilter($("#ag-company-filter"), (slug) => { state.company = slug; load(); }, state.company);
    // Filtro de responsável: só para quem acompanha outras pessoas.
    const supervises = status.user.isMaster || (window.CompanyContext.companies || []).some((company) => company.role === "SUPERVISOR");
    if (supervises) {
      $("#ag-assignee-field").hidden = false;
      const users = await api("/api/users").catch(() => []);
      $("#ag-assignee").innerHTML += users.filter((user) => user.id !== status.user.id).map((user) => `<option value="${esc(user.id)}">${esc(user.name)}</option>`).join("");
      $("#ag-subtitle").textContent = status.user.isMaster
        ? "Retornos e compromissos de todas as empresas que você acessa."
        : "Seus retornos e os da equipe que você supervisiona.";
    }
    state.anchor = todayKey();
    let mode = "list";
    try { mode = localStorage.getItem("mibro-agenda-mode") || "list"; } catch { /* ignore */ }
    setMode(["list", "day", "week", "month"].includes(mode) ? mode : "list");
    listenRealtime();
    const requested = new URLSearchParams(location.search).get("followUp");
    if (requested) openDetail(requested);
  } catch (error) {
    toast(error.message, true);
  }
})();
