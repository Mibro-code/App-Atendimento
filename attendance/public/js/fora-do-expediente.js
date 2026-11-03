// Configurações → Fora do expediente. Toda permissão é revalidada no
// backend; aqui só escondemos o que a conta não pode alterar.
const $ = (selector) => document.querySelector(selector);
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const STATUS_LABELS = {
  PENDING: "Pendente", PROCESSING: "Em envio", SENT: "Enviado", CANCELLED: "Cancelado",
  SKIPPED: "Ignorado", FAILED: "Falha", UNKNOWN: "Resultado desconhecido",
};
const REASON_LABELS = {
  QUIET_HOURS_DEFERRED: "Adiado para o fim do horário de silêncio",
  QUIET_HOURS_UNTIL_WINDOW_END: "O silêncio iria até depois do fim da janela de 24 h",
  WINDOW_TOO_SHORT: "A janela de 24 h terminaria antes do lembrete",
  WINDOW_EXPIRED: "Janela de 24 h encerrada",
  WINDOW_SAFETY_MARGIN: "Dentro da margem de segurança antes do fim da janela",
  TEAM_BACK_IN_BUSINESS_HOURS: "A equipe já estava em expediente",
  CUSTOMER_WROTE_DURING_BUSINESS_HOURS: "Cliente escreveu dentro do expediente",
  RESCHEDULED_NEWER_MESSAGE: "Reagendado por mensagem nova do cliente",
  HUMAN_REPLIED: "Atendente respondeu",
  HUMAN_ASSIGNED: "Atendente assumiu ou recebeu a conversa",
  HUMAN_ATTENDING: "Conversa em atendimento humano",
  CONVERSATION_FINALIZED: "Conversa finalizada",
  CONVERSATION_NOT_FOUND: "Conversa não existe mais",
  NOT_PENDING: "Conversa não estava mais pendente",
  OUTSIDE_REMINDER_DAYS: "Fora dos dias de lembrete (fim de semana, feriado ou sexta após o expediente)",
  BOT_FLOW_IN_PROGRESS: "Bot ainda conversando com o cliente",
  COMPANY_INACTIVE: "Empresa desativada",
  COMPANY_CHANGED: "Conversa mudou de empresa",
  AUTOMATION_DISABLED: "Automação desativada",
  CONTACT_OPTED_OUT: "Cliente pediu para não receber mensagens",
  CONTACT_WITHOUT_PHONE: "Contato sem telefone",
  NUMBER_UNAVAILABLE: "Número de WhatsApp desconectado ou indisponível",
  EMPTY_MESSAGE: "Mensagem do lembrete vazia",
  META_REJECTED: "A Meta recusou o envio",
  META_RATE_LIMITED: "A Meta limitou os envios no momento",
  SENDER_NOT_CONFIGURED: "Número sem credencial configurada",
  META_TIMEOUT: "Tempo esgotado na Meta — pode ter sido entregue",
  META_RESULT_UNKNOWN: "A Meta não confirmou o resultado",
  INTERRUPTED_DURING_SEND: "Servidor reiniciou durante o envio",
  SENT_NOT_RECORDED: "Aceito pela Meta, mas não registrado no histórico",
  RECOVERED_AFTER_RESTART: "Retomado após reinício do servidor",
  INTERNAL_ERROR: "Erro interno antes do envio (nada foi enviado)",
  REPROCESS_REQUESTED: "Reprocessamento solicitado",
  MANUAL_CANCEL: "Cancelado manualmente",
};
const DELIVERY_LABELS = { ENVIADA: "aceito pela Meta", ENTREGUE: "entregue", LIDA: "lido", FALHOU: "falha na entrega" };

const state = { user: null, scope: "GLOBAL", settings: null, canEdit: false, holidays: null, year: new Date().getFullYear(), editingHoliday: null };

async function api(url, options = {}) {
  const headers = { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) };
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) { location.replace("/login.html"); throw new Error("Sessão encerrada."); }
  const body = response.status === 204 ? null : await response.json().catch(() => ({}));
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

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const scopeQuery = () => (state.scope !== "GLOBAL" ? `company=${encodeURIComponent(state.scope)}` : "");
const withScope = (url) => { const query = scopeQuery(); return query ? `${url}${url.includes("?") ? "&" : "?"}${query}` : url; };
const dateTime = (value) => (value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: state.settings?.timezone || "America/Sao_Paulo" }).format(new Date(value)) : "—");

// Proteção contra duplo clique: o botão fica ocupado até a resposta.
async function withBusy(button, task) {
  if (button.dataset.busy) return;
  button.dataset.busy = "1";
  button.disabled = true;
  try { await task(); } finally { delete button.dataset.busy; button.disabled = false; }
}

// ------------------------------------------------------------ Configurações

function renderDays(selected) {
  $("#ah-days").innerHTML = WEEKDAYS.map((label, day) => `<label class="ah-day"><input type="checkbox" value="${day}" ${selected.includes(day) ? "checked" : ""}><span>${label}</span></label>`).join("");
}

function fillForm(settings) {
  $("#ah-enabled").checked = settings.enabled;
  $("#ah-start").value = settings.businessStartTime;
  $("#ah-end").value = settings.businessEndTime;
  $("#ah-timezone").value = settings.timezone;
  if ($("#ah-timezone").value !== settings.timezone) $("#ah-timezone").add(new Option(settings.timezone, settings.timezone, true, true));
  renderDays(settings.businessDays || []);
  $("#ah-saturday").checked = settings.remindOnSaturday;
  $("#ah-sunday").checked = settings.remindOnSunday;
  $("#ah-holidays").checked = settings.remindOnHolidays;
  $("#ah-delay").value = settings.delayMinutes / 60;
  $("#ah-margin").value = settings.metaSafetyMarginMinutes;
  $("#ah-only-pending").checked = settings.onlyPending;
  $("#ah-only-without-human").checked = settings.onlyWithoutHuman;
  $("#ah-max").value = settings.maxPerCycle;
  $("#ah-quiet").checked = settings.quietHoursEnabled;
  $("#ah-quiet-start").value = settings.quietStartTime;
  $("#ah-quiet-end").value = settings.quietEndTime;
  $("#ah-message").value = settings.reminderMessage;
  syncPreview();
  syncQuiet();
}

function collectPayload() {
  return {
    enabled: $("#ah-enabled").checked,
    businessStartTime: $("#ah-start").value, businessEndTime: $("#ah-end").value,
    timezone: $("#ah-timezone").value,
    businessDays: [...document.querySelectorAll("#ah-days input:checked")].map((input) => Number(input.value)),
    remindOnSaturday: $("#ah-saturday").checked, remindOnSunday: $("#ah-sunday").checked, remindOnHolidays: $("#ah-holidays").checked,
    delayMinutes: Math.round(Number($("#ah-delay").value) * 60),
    metaSafetyMarginMinutes: Number($("#ah-margin").value),
    onlyPending: $("#ah-only-pending").checked, onlyWithoutHuman: $("#ah-only-without-human").checked,
    quietHoursEnabled: $("#ah-quiet").checked, quietStartTime: $("#ah-quiet-start").value, quietEndTime: $("#ah-quiet-end").value,
    reminderMessage: $("#ah-message").value.trim(),
    ...(state.scope !== "GLOBAL" ? { company: state.scope } : {}),
  };
}

function syncPreview() {
  const text = $("#ah-message").value;
  $("#ah-preview-text").textContent = text.trim() || "Escreva a mensagem do lembrete.";
  $("#ah-message-count").textContent = `${text.length}/1000`;
}

function syncQuiet() {
  const enabled = $("#ah-quiet").checked && state.canEdit;
  $("#ah-quiet-start").disabled = !enabled;
  $("#ah-quiet-end").disabled = !enabled;
}

function setReadOnly(readOnly) {
  $("#ah-readonly-note").hidden = !readOnly;
  $("#ah-readonly-note").textContent = state.scope === "GLOBAL" && !state.user?.isMaster
    ? "Somente leitura — as regras globais são alteradas apenas pelo Master. Escolha sua empresa para ver as regras dela."
    : "Somente leitura — sua conta não tem permissão para alterar estas regras.";
  $("#ah-save").hidden = readOnly;
  $("#ah-form").querySelectorAll("input, select, textarea").forEach((input) => {
    if (input.dataset.alwaysDisabled) return;
    input.disabled = readOnly;
  });
  syncQuiet();
}

function syncCompanyNote(payload) {
  const company = window.CompanyContext.companies.find((item) => item.slug === state.scope);
  $("#ah-company-note").textContent = !company ? "Padrão para todas as empresas sem regra própria."
    : payload.isCompanyOverride ? `${company.name} usa regra própria.` : `${company.name} usa a regra global — salvar cria uma regra própria.`;
  $("#ah-company-reset").hidden = !company || !payload.isCompanyOverride || !payload.canEdit;
}

async function loadSettings() {
  $("#ah-loading").hidden = false;
  $("#ah-load-error").hidden = true;
  try {
    const payload = await api(withScope("/api/after-hours/settings"));
    state.settings = payload.settings;
    state.canEdit = payload.canEdit;
    fillForm(payload.settings);
    setReadOnly(!payload.canEdit);
    syncCompanyNote(payload);
    $("#ah-form").hidden = false;
  } catch (error) {
    $("#ah-form").hidden = true;
    $("#ah-load-error-text").textContent = `Não foi possível carregar as configurações: ${error.message}`;
    $("#ah-load-error").hidden = false;
    throw error;
  } finally {
    $("#ah-loading").hidden = true;
  }
}

$("#ah-message").addEventListener("input", syncPreview);
$("#ah-quiet").addEventListener("change", syncQuiet);
$("#ah-retry").addEventListener("click", () => loadAll().catch(() => {}));

$("#ah-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const errorBox = $("#ah-form-error");
  errorBox.hidden = true;
  const payload = collectPayload();
  if (!payload.businessDays.length) { errorBox.textContent = "Escolha ao menos um dia de funcionamento."; errorBox.hidden = false; return; }
  if (!payload.reminderMessage) { errorBox.textContent = "Escreva a mensagem do lembrete."; errorBox.hidden = false; return; }
  withBusy($("#ah-save"), async () => {
    try {
      const result = await api("/api/after-hours/settings", { method: "PATCH", body: JSON.stringify(payload) });
      state.settings = result.settings;
      fillForm(result.settings);
      syncCompanyNote(result);
      toast("Configurações salvas.");
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
    }
  });
});

$("#ah-company-reset").addEventListener("click", () => withBusy($("#ah-company-reset"), async () => {
  try {
    const result = await api(`/api/after-hours/settings/company/${encodeURIComponent(state.scope)}`, { method: "DELETE" });
    fillForm(result.settings);
    syncCompanyNote(result);
    toast("A empresa voltou a usar a regra global.");
  } catch (error) { toast(error.message, true); }
}));

// ------------------------------------------------------------ Feriados

const SCOPE_LABELS = { NACIONAL: "Nacional", ESTADUAL: "Estadual", MUNICIPAL: "Municipal", EMPRESA: "Empresa", EXCECAO: "Exceção" };
const SOURCE_LABELS = { OWN: "", GLOBAL: "herdado da regra global", BUILTIN: "nacional automático" };

function renderYearOptions() {
  const current = new Date().getFullYear();
  $("#ah-year").innerHTML = [current - 1, current, current + 1, current + 2].map((year) => `<option value="${year}" ${year === state.year ? "selected" : ""}>${year}</option>`).join("");
  $("#ah-import-national").textContent = `Cadastrar feriados nacionais de ${state.year}`;
}

function formatHolidayDate(date) {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
}

function renderHolidays() {
  const list = $("#ah-holiday-list");
  const { holidays, canEdit } = state.holidays;
  $("#ah-import-national").hidden = !canEdit;
  $("#ah-holiday-new").hidden = !canEdit || !$("#ah-holiday-form").hidden;
  if (!holidays.length) {
    list.innerHTML = "";
    $("#ah-holiday-state").textContent = "Nenhuma data neste ano.";
    $("#ah-holiday-state").hidden = false;
    return;
  }
  $("#ah-holiday-state").hidden = true;
  list.innerHTML = holidays.map((holiday, index) => {
    const special = holiday.allDay ? "Fechado o dia inteiro" : `Expediente especial ${holiday.openTime}–${holiday.closeTime}`;
    const source = SOURCE_LABELS[holiday.source];
    const actions = canEdit ? `<div class="ah-row-actions">
        <button type="button" class="secondary" data-holiday-edit="${index}">Editar</button>
        <button type="button" class="secondary" data-holiday-toggle="${index}">${holiday.effective ? "Desativar" : "Reativar"}</button>
      </div>` : "";
    return `<li class="ah-holiday ${holiday.effective ? "" : "inactive"}">
      <div><b>${escapeHtml(formatHolidayDate(holiday.date))}</b> · ${escapeHtml(holiday.name)}
        <small>${escapeHtml(SCOPE_LABELS[holiday.scope] || holiday.scope)}${holiday.region ? ` · ${escapeHtml(holiday.region)}` : ""} · ${escapeHtml(special)}${source ? ` · ${escapeHtml(source)}` : ""}${holiday.effective ? "" : " · desativado"}</small>
      </div>${actions}</li>`;
  }).join("");
}

async function loadHolidays() {
  $("#ah-holiday-state").textContent = "Carregando feriados…";
  $("#ah-holiday-state").hidden = false;
  $("#ah-holiday-state").classList.remove("ah-error");
  try {
    state.holidays = await api(withScope(`/api/after-hours/holidays?year=${state.year}`));
    renderYearOptions();
    renderHolidays();
  } catch (error) {
    $("#ah-holiday-list").innerHTML = "";
    $("#ah-holiday-state").innerHTML = `${escapeHtml(`Não foi possível carregar os feriados: ${error.message}`)} <button type="button" id="ah-holiday-retry">Tentar novamente</button>`;
    $("#ah-holiday-state").classList.add("ah-error");
    $("#ah-holiday-retry").addEventListener("click", () => loadHolidays().catch(() => {}));
  }
  $("#ah-holidays-card").hidden = false;
}

function openHolidayForm(holiday = null) {
  state.editingHoliday = holiday;
  $("#ah-holiday-form-title").textContent = holiday ? `Editar ${holiday.name}` : "Nova data";
  $("#ah-h-date").value = holiday?.date || `${state.year}-01-01`;
  // Data de linha já cadastrada no próprio escopo não muda (é a chave).
  $("#ah-h-date").disabled = Boolean(holiday && holiday.source === "OWN") || Boolean(holiday?.builtin) || Boolean(holiday && holiday.source === "GLOBAL");
  $("#ah-h-name").value = holiday?.name || "";
  $("#ah-h-scope").value = holiday?.scope || (state.scope === "GLOBAL" ? "MUNICIPAL" : "EMPRESA");
  $("#ah-h-region").value = holiday?.region || "";
  $("#ah-h-allday").checked = holiday ? holiday.allDay : true;
  $("#ah-h-open").value = holiday?.openTime || "08:00";
  $("#ah-h-close").value = holiday?.closeTime || "12:00";
  syncHolidayHours();
  $("#ah-h-error").hidden = true;
  $("#ah-holiday-form").hidden = false;
  $("#ah-holiday-new").hidden = true;
  $("#ah-h-name").focus();
}

function closeHolidayForm() {
  $("#ah-holiday-form").hidden = true;
  state.editingHoliday = null;
  if (state.holidays) renderHolidays();
}

function syncHolidayHours() {
  const special = !$("#ah-h-allday").checked;
  $("#ah-h-open").disabled = !special;
  $("#ah-h-close").disabled = !special;
}

// Linha do próprio escopo: PATCH. Herdada (global/nacional): cria a linha
// do escopo atual, que passa a prevalecer.
async function saveHoliday(holiday, fields) {
  if (holiday && holiday.source === "OWN" && holiday.id) {
    return api(`/api/after-hours/holidays/${encodeURIComponent(holiday.id)}`, { method: "PATCH", body: JSON.stringify(fields) });
  }
  return api("/api/after-hours/holidays", { method: "POST", body: JSON.stringify({ ...fields, date: holiday?.date || fields.date, ...(state.scope !== "GLOBAL" ? { company: state.scope } : {}) }) });
}

$("#ah-h-allday").addEventListener("change", syncHolidayHours);
$("#ah-h-cancel").addEventListener("click", closeHolidayForm);
$("#ah-holiday-new").addEventListener("click", () => openHolidayForm());
$("#ah-holiday-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const errorBox = $("#ah-h-error");
  errorBox.hidden = true;
  const fields = {
    date: $("#ah-h-date").value, name: $("#ah-h-name").value.trim(), scope: $("#ah-h-scope").value,
    region: $("#ah-h-region").value.trim(), allDay: $("#ah-h-allday").checked,
    openTime: $("#ah-h-allday").checked ? null : $("#ah-h-open").value, closeTime: $("#ah-h-allday").checked ? null : $("#ah-h-close").value,
  };
  if (!fields.date || !fields.name) { errorBox.textContent = "Informe a data e o nome."; errorBox.hidden = false; return; }
  withBusy($("#ah-h-save"), async () => {
    try {
      await saveHoliday(state.editingHoliday, fields);
      closeHolidayForm();
      toast("Data salva.");
      await loadHolidays();
    } catch (error) { errorBox.textContent = error.message; errorBox.hidden = false; }
  });
});

$("#ah-holiday-list").addEventListener("click", (event) => {
  const edit = event.target.closest("[data-holiday-edit]");
  const toggle = event.target.closest("[data-holiday-toggle]");
  if (edit) openHolidayForm(state.holidays.holidays[Number(edit.dataset.holidayEdit)]);
  if (toggle) {
    const holiday = state.holidays.holidays[Number(toggle.dataset.holidayToggle)];
    withBusy(toggle, async () => {
      try {
        await saveHoliday(holiday, { name: holiday.name, scope: holiday.scope, region: holiday.region || "", allDay: holiday.allDay, openTime: holiday.openTime, closeTime: holiday.closeTime, active: !holiday.effective });
        toast(holiday.effective ? "Data desativada — o dia conta como dia normal." : "Data reativada.");
        await loadHolidays();
      } catch (error) { toast(error.message, true); }
    });
  }
});

$("#ah-year").addEventListener("change", () => { state.year = Number($("#ah-year").value); closeHolidayForm(); loadHolidays(); });
$("#ah-import-national").addEventListener("click", () => withBusy($("#ah-import-national"), async () => {
  try {
    const result = await api("/api/after-hours/holidays/import-national", { method: "POST", body: JSON.stringify({ year: state.year, ...(state.scope !== "GLOBAL" ? { company: state.scope } : {}) }) });
    toast(result.created ? `${result.created} feriado(s) nacional(is) cadastrado(s).` : "Os feriados nacionais deste ano já estavam cadastrados.");
    await loadHolidays();
  } catch (error) { toast(error.message, true); }
}));

// ------------------------------------------------------------ Monitoramento

function renderCounters(monitor) {
  const items = [
    ["PENDING", "Pendentes"], ["SENT", "Enviados"], ["CANCELLED", "Cancelados"],
    ["SKIPPED_WINDOW", "Ignorados por janela"], ["SKIPPED", "Ignorados (total)"], ["FAILED", "Falhas"], ["UNKNOWN", "Desconhecidos"],
  ];
  $("#ah-counters").innerHTML = items.map(([key, label]) => {
    const value = key === "SKIPPED_WINDOW" ? monitor.skippedWindow : monitor.counts[key] || 0;
    return `<div class="ah-counter ${key.toLowerCase()}"><strong>${value}</strong><span>${label}</span></div>`;
  }).join("");
  $("#ah-next-run").textContent = monitor.nextDueAt ? `Próxima execução prevista: ${dateTime(monitor.nextDueAt)}.` : "Nenhum lembrete pendente.";
}

function reminderRow(item) {
  const reason = item.reason ? REASON_LABELS[item.reason] || (item.reason.startsWith("OBSOLETE_") ? `Substituído por mensagem nova (${REASON_LABELS[item.reason.slice(9)] || item.reason.slice(9)})` : item.reason) : "";
  const delivery = item.deliveryStatus ? ` · ${DELIVERY_LABELS[item.deliveryStatus] || item.deliveryStatus}` : "";
  const canAct = state.canEdit || state.user?.isMaster;
  const actions = [
    item.status === "FAILED" && canAct ? `<button type="button" class="secondary" data-reprocess="${escapeHtml(item.id)}">Reprocessar</button>` : "",
    item.status === "PENDING" && canAct ? `<button type="button" class="secondary" data-cancel-reminder="${escapeHtml(item.id)}">Cancelar</button>` : "",
    `<a class="ah-link" href="/?conversation=${encodeURIComponent(item.conversationId)}">Abrir conversa</a>`,
  ].join("");
  const when = item.status === "SENT" ? `Enviado ${dateTime(item.sentAt)}` : item.status === "PENDING" ? `Previsto ${dateTime(item.dueAt)}` : `Atualizado ${dateTime(item.updatedAt)}`;
  return `<li class="ah-reminder status-${item.status.toLowerCase()}">
    <div class="ah-reminder-main">
      <span class="ah-badge">${STATUS_LABELS[item.status] || item.status}</span>
      <b>${escapeHtml(item.contactName)}</b> <small>${escapeHtml(item.contactPhone)} · ${escapeHtml(item.channelAccountName)}</small>
    </div>
    <div class="ah-reminder-meta">${escapeHtml(when)}${escapeHtml(delivery)} · cliente escreveu ${escapeHtml(dateTime(item.referenceAt))} · janela até ${escapeHtml(dateTime(item.windowExpiresAt))}</div>
    ${reason ? `<div class="ah-reminder-reason">Motivo: ${escapeHtml(reason)}</div>` : ""}
    <div class="ah-row-actions">${actions}</div>
  </li>`;
}

let monitorSeq = 0;
async function loadMonitor() {
  const seq = ++monitorSeq;
  const status = $("#ah-status-filter").value;
  const stateBox = $("#ah-monitor-state");
  $("#ah-monitor-card").hidden = false;
  stateBox.classList.remove("ah-error");
  if (!$("#ah-reminder-list").children.length) { stateBox.textContent = "Carregando lembretes…"; stateBox.hidden = false; }
  try {
    const monitor = await api(withScope(`/api/after-hours/reminders${status ? `?status=${status}` : ""}`));
    if (seq !== monitorSeq) return;
    renderCounters(monitor);
    $("#ah-reminder-list").innerHTML = monitor.reminders.map(reminderRow).join("");
    stateBox.hidden = Boolean(monitor.reminders.length);
    stateBox.textContent = status ? "Nenhum lembrete nesta situação." : "Nenhum lembrete nos últimos 7 dias.";
  } catch (error) {
    if (seq !== monitorSeq) return;
    $("#ah-reminder-list").innerHTML = "";
    stateBox.innerHTML = `${escapeHtml(`Não foi possível carregar o monitoramento: ${error.message}`)} <button type="button" id="ah-monitor-retry">Tentar novamente</button>`;
    stateBox.classList.add("ah-error");
    stateBox.hidden = false;
    $("#ah-monitor-retry").addEventListener("click", () => loadMonitor());
  }
}

$("#ah-status-filter").addEventListener("change", () => loadMonitor());
$("#ah-monitor-refresh").addEventListener("click", () => withBusy($("#ah-monitor-refresh"), loadMonitor));
$("#ah-reminder-list").addEventListener("click", (event) => {
  const reprocess = event.target.closest("[data-reprocess]");
  const cancel = event.target.closest("[data-cancel-reminder]");
  const button = reprocess || cancel;
  if (!button) return;
  const id = reprocess ? reprocess.dataset.reprocess : cancel.dataset.cancelReminder;
  withBusy(button, async () => {
    try {
      await api(`/api/after-hours/reminders/${encodeURIComponent(id)}/${reprocess ? "reprocess" : "cancel"}`, { method: "POST" });
      toast(reprocess ? "Lembrete devolvido à fila — será reconferido antes do envio." : "Lembrete cancelado.");
      await loadMonitor();
    } catch (error) { toast(error.message, true); }
  });
});

// Tempo real: o worker publica no SSE da Central quando envia/falha; a tela
// recarrega o monitoramento sem refresh (com folga para rajadas).
function listenForChanges() {
  if (typeof EventSource === "undefined") return;
  let timer = null;
  const source = new EventSource("/api/events");
  source.addEventListener("inbox.updated", () => {
    clearTimeout(timer);
    timer = setTimeout(() => { if (!document.hidden) loadMonitor(); }, 1500);
  });
}

// ------------------------------------------------------------ Boot

async function loadAll() {
  await loadSettings();
  await Promise.all([loadHolidays(), loadMonitor()]);
}

$("#theme-toggle").addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme !== "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  try { localStorage.setItem("mibro-theme", dark ? "dark" : "light"); } catch { /* ignore */ }
});
$("#logout").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" });
  location.href = "/login.html";
});

(async function boot() {
  try {
    const status = await api("/api/auth/status");
    state.user = status.user;
    $("#current-user").textContent = status.user.name;
    await window.CompanyContext.load();
    const companies = window.CompanyContext.companies;
    // Supervisor começa na própria empresa (a global é só leitura para ele).
    if (!status.user.isMaster && companies.length) state.scope = companies[0].slug;
    if (window.CompanyContext.multi()) {
      $("#ah-company-bar").hidden = false;
      window.CompanyContext.mountFilter($("#ah-company-filter"), (slug) => {
        state.scope = slug === "ALL" ? "GLOBAL" : slug;
        closeHolidayForm();
        loadAll().catch(() => {});
      }, state.scope === "GLOBAL" ? "ALL" : state.scope, { allLabel: "Global" });
    }
    await loadAll();
    listenForChanges();
  } catch (error) {
    if (!$("#ah-load-error").hidden) return;
    toast(error.message, true);
  }
})();
