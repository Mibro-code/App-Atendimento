const state = { bots: [], categories: [], selected: null };
const $ = (selector) => document.querySelector(selector);
const statusLabels = { DRAFT: "RASCUNHO", ACTIVE: "ATIVO", PAUSED: "PAUSADO" };
const dayNames = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

async function api(url, options = {}) {
  const headers = { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) };
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) { location.replace("/login.html"); throw new Error("Sessão encerrada."); }
  const body = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || "Não foi possível concluir a operação.");
  return body;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function toast(message, error = false) {
  const element = $("#toast");
  element.textContent = message;
  element.className = `toast show${error ? " error" : ""}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { element.className = "toast"; }, 3200);
}

function categoryOptions(selected = "") {
  return `<option value="">Sem categoria padrão</option>${state.categories.map((category) => (
    `<option value="${escapeHtml(category.id)}" ${category.id === selected ? "selected" : ""}>${escapeHtml(category.parentId ? `- ${category.name}` : category.name)}</option>`
  )).join("")}`;
}

function renderBotList() {
  $("#bot-count").textContent = `${state.bots.length} Bot${state.bots.length === 1 ? "" : "s"} configurado${state.bots.length === 1 ? "" : "s"}`;
  $("#bot-list").innerHTML = state.bots.length ? state.bots.map((bot) => `
    <button class="bot-card ${state.selected?.id === bot.id ? "active" : ""}" type="button" data-bot-id="${escapeHtml(bot.id)}">
      <header><b>${escapeHtml(bot.name)}</b><span class="mini-status ${bot.status}">${statusLabels[bot.status]}</span></header>
      <small>${escapeHtml(bot.description || "Sem descrição")}</small>
      <div class="bot-meta"><span>${bot.channel === "META" ? "WhatsApp (Meta)" : "Zenvia"}</span><span>\u2022</span><span>${bot._count.intents} intenção(ões)</span></div>
    </button>
  `).join("") : '<div class="intent-empty">Nenhum Bot criado.</div>';
  document.querySelectorAll("[data-bot-id]").forEach((button) => button.addEventListener("click", () => selectBot(button.dataset.botId)));
}

function renderSchedules(schedules = []) {
  const byDay = new Map(schedules.map((item) => [item.dayOfWeek, item]));
  $("#schedule-list").innerHTML = dayNames.map((name, dayOfWeek) => {
    const row = byDay.get(dayOfWeek);
    return `<label class="schedule-row" data-day="${dayOfWeek}">
      <input class="schedule-enabled" type="checkbox" ${row?.enabled ? "checked" : ""}>
      <b>${name}</b>
      <input class="schedule-start" type="time" value="${row?.startTime || "08:00"}" aria-label="Início">
      <input class="schedule-end" type="time" value="${row?.endTime || "17:00"}" aria-label="Fim">
    </label>`;
  }).join("");
}

function renderIntents() {
  const intents = state.selected?.intents || [];
  $("#intent-list").innerHTML = intents.length ? intents.map((intent) => `
    <article class="intent-card ${intent.active ? "" : "inactive"}">
      <div><b>${escapeHtml(intent.name)}</b><small>${escapeHtml(intent.category?.name || "Sem categoria")} \u2022 prioridade ${intent.priority} \u2022 ${intent.examples.length} exemplo(s)</small></div>
      <div><button type="button" data-edit-intent="${escapeHtml(intent.id)}">Editar</button><button type="button" data-delete-intent="${escapeHtml(intent.id)}">Excluir</button></div>
    </article>
  `).join("") : '<div class="intent-empty">Nenhuma intenção configurada.</div>';
  document.querySelectorAll("[data-edit-intent]").forEach((button) => button.addEventListener("click", () => editIntent(button.dataset.editIntent)));
  document.querySelectorAll("[data-delete-intent]").forEach((button) => button.addEventListener("click", () => removeIntent(button.dataset.deleteIntent)));
}

function fillBotForm(bot = null) {
  $("#bot-name").value = bot?.name || "";
  $("#bot-description").value = bot?.description || "";
  $("#bot-channel").value = bot?.channel || "META";
  $("#bot-timezone").value = bot?.timezone || "America/Sao_Paulo";
  $("#bot-category").innerHTML = categoryOptions(bot?.defaultCategoryId || "");
  $("#bot-initial").value = bot?.initialMessage || "";
  $("#bot-outside").value = bot?.outsideHoursMessage || "";
  $("#bot-fallback").value = bot?.fallbackMessage || "";
}

function renderEditor() {
  const bot = state.selected;
  $("#empty-state").hidden = Boolean(bot) || $("#editor").dataset.creating === "true";
  $("#editor").hidden = !bot && $("#editor").dataset.creating !== "true";
  if (!bot) return;
  $("#editor").dataset.creating = "false";
  $("#editor-eyebrow").textContent = "BOT SELECIONADO";
  $("#editor-title").textContent = bot.name;
  $("#editor-description").textContent = bot.description || "Configuração administrativa isolada do atendimento real.";
  $("#status-actions").hidden = false;
  $("#status-badge").textContent = statusLabels[bot.status];
  $("#status-badge").className = `status-badge ${bot.status}`;
  document.querySelectorAll(".requires-bot").forEach((element) => { element.hidden = false; });
  fillBotForm(bot);
  $("#intent-category").innerHTML = categoryOptions();
  renderSchedules(bot.schedules);
  renderIntents();
  renderBotList();
}

async function loadBots(selectId = state.selected?.id) {
  state.bots = await api("/api/bots");
  renderBotList();
  if (selectId && state.bots.some((bot) => bot.id === selectId)) await selectBot(selectId);
  else if (!state.bots.length) {
    state.selected = null;
    $("#editor").dataset.creating = "false";
    $("#editor").hidden = true;
    $("#empty-state").hidden = false;
  }
}

async function selectBot(botId) {
  state.selected = await api(`/api/bots/${encodeURIComponent(botId)}`);
  closeIntentForm();
  $("#simulator-result").innerHTML = "<p>O resultado da simulação aparecerá aqui.</p>";
  renderEditor();
}

function startNewBot() {
  state.selected = null;
  $("#editor").dataset.creating = "true";
  $("#empty-state").hidden = true;
  $("#editor").hidden = false;
  $("#editor-eyebrow").textContent = "NOVO BOT";
  $("#editor-title").textContent = "Criar Bot";
  $("#editor-description").textContent = "O novo Bot começará como rascunho e permanecerá desconectado do webhook.";
  $("#status-actions").hidden = true;
  document.querySelectorAll(".requires-bot").forEach((element) => { element.hidden = true; });
  fillBotForm();
  renderBotList();
}

function botPayload() {
  return {
    name: $("#bot-name").value,
    description: $("#bot-description").value,
    channel: $("#bot-channel").value,
    timezone: $("#bot-timezone").value,
    defaultCategoryId: $("#bot-category").value || null,
    initialMessage: $("#bot-initial").value,
    outsideHoursMessage: $("#bot-outside").value,
    fallbackMessage: $("#bot-fallback").value,
  };
}

function closeIntentForm() {
  $("#intent-form").hidden = true;
  $("#intent-form").reset();
  $("#intent-id").value = "";
  $("#intent-priority").value = "0";
  $("#intent-active").checked = true;
}

function editIntent(intentId) {
  const intent = state.selected.intents.find((item) => item.id === intentId);
  if (!intent) return;
  $("#intent-id").value = intent.id;
  $("#intent-name").value = intent.name;
  $("#intent-description").value = intent.description || "";
  $("#intent-response").value = intent.responseMessage || "";
  $("#intent-priority").value = intent.priority;
  $("#intent-action").value = intent.fallbackAction;
  $("#intent-category").innerHTML = categoryOptions(intent.categoryId || "");
  $("#intent-examples").value = intent.examples.map(({ text }) => text).join("\n");
  $("#intent-active").checked = intent.active;
  $("#intent-form").hidden = false;
  $("#intent-name").focus();
}

async function removeIntent(intentId) {
  if (!confirm("Remover esta intenção?")) return;
  try {
    await api(`/api/bots/${state.selected.id}/intents/${intentId}`, { method: "DELETE" });
    toast("Intenção removida.");
    await selectBot(state.selected.id);
  } catch (error) { toast(error.message, true); }
}

$("#bot-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const bot = state.selected
      ? await api(`/api/bots/${state.selected.id}`, { method: "PATCH", body: JSON.stringify(botPayload()) })
      : await api("/api/bots", { method: "POST", body: JSON.stringify(botPayload()) });
    toast(state.selected ? "Bot atualizado." : "Bot criado como rascunho.");
    await loadBots(bot.id);
  } catch (error) { toast(error.message, true); }
});

$("#schedule-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const schedules = [...document.querySelectorAll(".schedule-row")].map((row) => ({
    dayOfWeek: Number(row.dataset.day),
    enabled: row.querySelector(".schedule-enabled").checked,
    startTime: row.querySelector(".schedule-start").value,
    endTime: row.querySelector(".schedule-end").value,
  }));
  try {
    await api(`/api/bots/${state.selected.id}/schedules`, { method: "PUT", body: JSON.stringify({ schedules }) });
    toast("Horários atualizados.");
    await selectBot(state.selected.id);
  } catch (error) { toast(error.message, true); }
});

$("#intent-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const intentId = $("#intent-id").value;
  const payload = {
    name: $("#intent-name").value,
    description: $("#intent-description").value,
    responseMessage: $("#intent-response").value,
    priority: Number($("#intent-priority").value),
    active: $("#intent-active").checked,
    fallbackAction: $("#intent-action").value,
    categoryId: $("#intent-category").value || null,
    examples: $("#intent-examples").value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
  };
  try {
    const url = intentId ? `/api/bots/${state.selected.id}/intents/${intentId}` : `/api/bots/${state.selected.id}/intents`;
    await api(url, { method: intentId ? "PATCH" : "POST", body: JSON.stringify(payload) });
    toast(intentId ? "Intenção atualizada." : "Intenção criada.");
    closeIntentForm();
    await selectBot(state.selected.id);
  } catch (error) { toast(error.message, true); }
});

$("#simulator-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const result = await api(`/api/bots/${state.selected.id}/simulate`, {
      method: "POST",
      body: JSON.stringify({ message: $("#simulator-message").value }),
    });
    $("#simulator-result").innerHTML = `<b>${escapeHtml(result.response)}</b><div class="result-grid">
      <span>Horário<strong>${result.withinHours ? "Dentro do horário" : "Fora do horário"}</strong></span>
      <span>Intenção<strong>${escapeHtml(result.intent?.name || "Fallback")}</strong></span>
      <span>Exemplo<strong>${escapeHtml(result.matchedExample || "Nenhum")}</strong></span>
      <span>Categoria<strong>${escapeHtml(result.category?.name || "Nenhuma")}</strong></span>
    </div><p>${escapeHtml(result.warning)}</p>`;
  } catch (error) { toast(error.message, true); }
});

document.querySelectorAll("[data-status]").forEach((button) => button.addEventListener("click", async () => {
  try {
    await api(`/api/bots/${state.selected.id}/status`, { method: "PATCH", body: JSON.stringify({ status: button.dataset.status }) });
    toast("Status atualizado. O webhook permanece inalterado.");
    await loadBots(state.selected.id);
  } catch (error) { toast(error.message, true); }
}));

$("#archive-bot").addEventListener("click", async () => {
  if (!confirm("Arquivar este Bot? As configurações deixarão de aparecer na lista.")) return;
  try {
    await api(`/api/bots/${state.selected.id}`, { method: "DELETE" });
    toast("Bot arquivado.");
    state.selected = null;
    await loadBots();
  } catch (error) { toast(error.message, true); }
});

$("#new-intent").addEventListener("click", () => {
  closeIntentForm();
  $("#intent-category").innerHTML = categoryOptions();
  $("#intent-form").hidden = false;
  $("#intent-name").focus();
});
$("#cancel-intent").addEventListener("click", closeIntentForm);
$("#new-bot").addEventListener("click", startNewBot);
$("#empty-new-bot").addEventListener("click", startNewBot);
$("#theme-toggle").addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme === "dark";
  document.documentElement.dataset.theme = dark ? "light" : "dark";
  localStorage.setItem("mibro-theme", dark ? "light" : "dark");
  $("#theme-toggle").textContent = dark ? "\u263e" : "\u2600";
});
$("#logout").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" });
  location.replace("/login.html");
});

(async () => {
  try {
    const status = await api("/api/auth/status");
    if (!status.authenticated || !status.user.isMaster) return location.replace("/");
    $("#current-user").textContent = status.user.name;
    state.categories = (await api("/api/categories")).filter((category) => category.active !== false);
    $("#bot-category").innerHTML = categoryOptions();
    $("#intent-category").innerHTML = categoryOptions();
    renderSchedules();
    await loadBots();
  } catch (error) { toast(error.message, true); }
})();
