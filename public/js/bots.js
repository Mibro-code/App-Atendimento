const state = {
  bots: [], categories: [], selected: null,
  simulatorHistory: [], simulatorState: null,
  // Fluxo de atendimento (Flow Engine).
  flowSteps: [], flowStepsCache: new Map(), tools: [], knowledgeSources: [],
};
const flowActionLabels = {
  ASK_QUESTION: "Perguntar", USE_KNOWLEDGE: "Usar conhecimento", QUERY_TOOL: "Consultar Tool",
  RESPOND: "Responder", RESOLVED: "Resolvido", HANDOFF_HUMAN: "Encaminhar humano", GOTO_STEP: "Ir para etapa",
};
const actionLabels = {
  RESPOND: "Responder",
  ASK_CLARIFICATION: "Pedir esclarecimento",
  HANDOFF_HUMAN: "Encaminhar para humano",
  SWITCH_BOT: "Trocar de Bot",
  QUERY_TOOL: "Consultar ferramenta",
  NO_ACTION: "Nenhuma ação",
};
const $ = (selector) => document.querySelector(selector);
const statusLabels = { DRAFT: "RASCUNHO", ACTIVE: "ATIVO", PAUSED: "PAUSADO" };
const channelLabels = {
  META: "WhatsApp (Meta)",
  INSTAGRAM_DIRECT: "Instagram Direct",
  INSTAGRAM_COMMENTS: "Instagram Comentários",
  FACEBOOK_MESSENGER: "Facebook Messenger",
  FACEBOOK_COMMENTS: "Facebook Comentários",
  EMAIL: "E-mail",
  MERCADO_LIVRE: "Mercado Livre",
  TIKTOK_SHOP: "TikTok Shop",
  AMAZON_MARKETPLACE: "Amazon Marketplace",
  SHOPEE: "Shopee",
  SHEIN_MARKETPLACE: "SHEIN Marketplace",
  GOOGLE_REVIEWS: "Google Reviews / Perfil da Empresa",
  RECLAME_AQUI: "Reclame Aqui",
};
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
      <div class="bot-meta"><span>${escapeHtml(channelLabels[bot.channel] || "Canal legado")}</span><span>\u2022</span><span>${bot._count.intents} intenção(ões)</span></div>
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

const booleanFeatureFlags = [
  "interpretationEnabled", "conversationalBehaviorEnabled", "contextEnabled", "autoSwitchEnabled",
  "observationEnabled", "learningEnabled", "knowledgeSuggestionsEnabled", "knowledgeBaseEnabled",
  "handoffAutoPauseEnabled",
];
const numericFeatureFlags = {
  contextMaxMessages: 10, contextExpirationMinutes: 120, maxSwitchesPerWindow: 3, switchWindowMinutes: 10,
};
const defaultBooleanFeatureFlags = {
  interpretationEnabled: true, conversationalBehaviorEnabled: true, contextEnabled: true, autoSwitchEnabled: true,
  observationEnabled: true, learningEnabled: true, knowledgeSuggestionsEnabled: true, knowledgeBaseEnabled: false,
  handoffAutoPauseEnabled: true,
};

function renderChannelsChecklist(selectedChannels = []) {
  const primary = $("#bot-channel").value;
  $("#bot-channels-checklist").innerHTML = Object.entries(channelLabels)
    .filter(([value]) => value !== primary)
    .map(([value, label]) => `
      <label class="checkbox"><input type="checkbox" value="${value}" ${selectedChannels.includes(value) ? "checked" : ""}><span>${label}</span></label>
    `).join("");
}

function fillBotForm(bot = null) {
  $("#bot-name").value = bot?.name || "";
  $("#bot-description").value = bot?.description || "";
  $("#bot-channel").value = bot?.channel || "META";
  $("#bot-timezone").value = bot?.timezone || "America/Sao_Paulo";
  renderChannelsChecklist(bot?.channels || []);
  $("#bot-category").innerHTML = categoryOptions(bot?.defaultCategoryId || "");
  $("#bot-low-confidence").value = bot?.lowConfidenceThreshold ?? 0.55;
  $("#bot-high-confidence").value = bot?.highConfidenceThreshold ?? 0.8;
  $("#bot-initial").value = bot?.initialMessage || "";
  $("#bot-outside").value = bot?.outsideHoursMessage || "";
  $("#bot-fallback").value = bot?.fallbackMessage || "";

  $("#bot-introduce").checked = Boolean(bot?.introduceWithName);
  $("#bot-reintroduce").checked = bot ? Boolean(bot.reintroduceOnNewSession) : true;
  $("#bot-presentation").value = bot?.presentationMessage || "";

  $("#flag-autoReplyEnabled").checked = Boolean(bot?.autoReplyEnabled);
  $("#flag-toolsEnabled").checked = Boolean(bot?.toolsEnabled);
  $("#flag-ratingEnabled").checked = Boolean(bot?.ratingEnabled);
  const flags = bot?.featureFlags || {};
  for (const key of booleanFeatureFlags) {
    $(`#flag-${key}`).checked = flags[key] !== undefined ? Boolean(flags[key]) : defaultBooleanFeatureFlags[key];
  }
  for (const [key, fallback] of Object.entries(numericFeatureFlags)) {
    $(`#flag-${key}`).value = flags[key] ?? fallback;
  }

  $("#rating-enabled").checked = Boolean(bot?.ratingEnabled);
  $("#rating-request-comment").checked = Boolean(bot?.requestRatingComment);
  $("#rating-request-on").value = bot?.requestRatingOn || "BOT_COMPLETED";
  $("#rating-message").value = bot?.ratingMessage || "";
  $("#rating-followup").value = bot?.ratingFollowupMessage || "";
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

function resetSimulator() {
  state.simulatorHistory = [];
  state.simulatorState = null;
  $("#simulator-transcript").innerHTML = "";
  $("#simulator-result").innerHTML = "<p>O resultado da simulação aparecerá aqui.</p>";
  const flowInfo = document.getElementById("simulator-flow-info");
  if (flowInfo) { flowInfo.hidden = true; flowInfo.innerHTML = ""; }
}

async function selectBot(botId) {
  state.selected = await api(`/api/bots/${encodeURIComponent(botId)}`);
  closeIntentForm();
  resetSimulator();
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
  const featureFlags = {};
  for (const key of booleanFeatureFlags) featureFlags[key] = $(`#flag-${key}`).checked;
  for (const key of Object.keys(numericFeatureFlags)) featureFlags[key] = Number($(`#flag-${key}`).value);
  return {
    name: $("#bot-name").value,
    description: $("#bot-description").value,
    channel: $("#bot-channel").value,
    channels: Array.from(document.querySelectorAll("#bot-channels-checklist input:checked")).map((input) => input.value),
    timezone: $("#bot-timezone").value,
    defaultCategoryId: $("#bot-category").value || null,
    lowConfidenceThreshold: Number($("#bot-low-confidence").value),
    highConfidenceThreshold: Number($("#bot-high-confidence").value),
    initialMessage: $("#bot-initial").value,
    outsideHoursMessage: $("#bot-outside").value,
    fallbackMessage: $("#bot-fallback").value,
    introduceWithName: $("#bot-introduce").checked,
    reintroduceOnNewSession: $("#bot-reintroduce").checked,
    presentationMessage: $("#bot-presentation").value || null,
    autoReplyEnabled: $("#flag-autoReplyEnabled").checked,
    toolsEnabled: $("#flag-toolsEnabled").checked,
    ratingEnabled: $("#flag-ratingEnabled").checked,
    featureFlags,
  };
}

function closeIntentForm() {
  $("#intent-form").hidden = true;
  $("#intent-form").reset();
  $("#intent-id").value = "";
  $("#intent-priority").value = "0";
  $("#intent-active").checked = true;
  $("#intent-flow-section").hidden = true;
  closeFlowStepForm();
  state.flowSteps = [];
}

async function editIntent(intentId) {
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

  // Item 7 (UI): "Fluxo de atendimento" só existe para intenções já salvas
  // (as etapas pertencem a um intentId real).
  $("#intent-flow-section").hidden = false;
  closeFlowStepForm();
  try {
    await Promise.all([loadFlowSteps(intentId), ensureToolsLoaded(), ensureKnowledgeSourcesLoaded()]);
    populateFlowStepSelects();
  } catch (error) { toast(error.message, true); }
}

async function removeIntent(intentId) {
  if (!confirm("Remover esta intenção?")) return;
  try {
    await api(`/api/bots/${state.selected.id}/intents/${intentId}`, { method: "DELETE" });
    toast("Intenção removida.");
    await selectBot(state.selected.id);
  } catch (error) { toast(error.message, true); }
}

// ===== Fluxo de atendimento (Flow Engine) =====

async function ensureToolsLoaded() {
  if (state.tools.length) return state.tools;
  try { state.tools = await api("/api/bot-tools"); } catch { state.tools = []; }
  return state.tools;
}

async function ensureKnowledgeSourcesLoaded() {
  try {
    state.knowledgeSources = await api(`/api/knowledge-sources?botId=${encodeURIComponent(state.selected.id)}&active=true`);
  } catch { state.knowledgeSources = []; }
  return state.knowledgeSources;
}

function renderFlowSteps() {
  const intentId = $("#intent-id").value;
  const steps = state.flowSteps;
  $("#flow-step-list").innerHTML = steps.length ? steps.map((step) => `
    <article class="intent-card ${step.active ? "" : "inactive"}">
      <div><b>${step.order}. ${escapeHtml(step.name)}</b><small>${escapeHtml(flowActionLabels[step.action] || step.action)}${step.entityKey ? ` • entidade: ${escapeHtml(step.entityKey)}` : ""}</small></div>
      <div><button type="button" data-edit-flow-step="${escapeHtml(step.id)}">Editar</button><button type="button" data-delete-flow-step="${escapeHtml(step.id)}">Excluir</button></div>
    </article>
  `).join("") : '<div class="intent-empty">Nenhuma etapa configurada — a intenção responde uma única vez, como hoje.</div>';
  document.querySelectorAll("[data-edit-flow-step]").forEach((button) => button.addEventListener("click", () => openFlowStepForm(button.dataset.editFlowStep)));
  document.querySelectorAll("[data-delete-flow-step]").forEach((button) => button.addEventListener("click", () => removeFlowStep(button.dataset.deleteFlowStep)));
  populateFlowStepSelects(intentId);
}

async function loadFlowSteps(intentId) {
  state.flowSteps = await api(`/api/bots/${state.selected.id}/intents/${intentId}/flow-steps`);
  state.flowStepsCache.set(intentId, state.flowSteps);
  renderFlowSteps();
}

function populateFlowStepSelects(currentStepId) {
  const stepOptions = (placeholder) => `<option value="">${placeholder}</option>` + state.flowSteps
    .filter((step) => step.id !== $("#flow-step-id").value)
    .map((step) => `<option value="${escapeHtml(step.id)}" ${step.id === currentStepId ? "" : ""}>${step.order}. ${escapeHtml(step.name)}</option>`).join("");
  $("#flow-step-next").innerHTML = stepOptions("Encerra o fluxo");
  $("#flow-step-on-success").innerHTML = stepOptions('Usar "Próxima etapa"');
  $("#flow-step-on-failure").innerHTML = stepOptions('Usar "Próxima etapa"');
  $("#flow-step-goto").innerHTML = `<option value="">Selecione</option>` + state.flowSteps
    .filter((step) => step.id !== $("#flow-step-id").value)
    .map((step) => `<option value="${escapeHtml(step.id)}">${step.order}. ${escapeHtml(step.name)}</option>`).join("");
  $("#flow-step-knowledge").innerHTML = `<option value="">Buscar automaticamente pela intenção</option>` + state.knowledgeSources
    .map((source) => `<option value="${escapeHtml(source.id)}">${escapeHtml(source.title)}</option>`).join("");
  $("#flow-step-tool").innerHTML = `<option value="">Nenhuma</option>` + state.tools
    .map((tool) => `<option value="${escapeHtml(tool.name)}">${escapeHtml(tool.name)}${tool.enabled ? "" : " (desativada)"}</option>`).join("");
}

function flowStepFieldVisibility() {
  const action = $("#flow-step-action").value;
  document.querySelectorAll(".flow-field-question").forEach((el) => { el.hidden = action !== "ASK_QUESTION"; });
  document.querySelectorAll(".flow-field-knowledge").forEach((el) => { el.hidden = action !== "USE_KNOWLEDGE"; });
  document.querySelectorAll(".flow-field-tool").forEach((el) => { el.hidden = action !== "QUERY_TOOL"; });
  document.querySelectorAll(".flow-field-response").forEach((el) => { el.hidden = !["RESPOND", "RESOLVED", "HANDOFF_HUMAN"].includes(action); });
  document.querySelectorAll(".flow-field-goto").forEach((el) => { el.hidden = action !== "GOTO_STEP"; });
  $("#flow-step-question").required = action === "ASK_QUESTION";
  $("#flow-step-tool").required = action === "QUERY_TOOL";
  $("#flow-step-response").required = action === "RESPOND";
  $("#flow-step-goto").required = action === "GOTO_STEP";
}

function closeFlowStepForm() {
  $("#flow-step-form").hidden = true;
  $("#flow-step-form").reset();
  $("#flow-step-id").value = "";
}

function openFlowStepForm(stepId = "") {
  const step = stepId ? state.flowSteps.find((item) => item.id === stepId) : null;
  $("#flow-step-id").value = step?.id || "";
  $("#flow-step-name").value = step?.name || "";
  $("#flow-step-action").value = step?.action || "ASK_QUESTION";
  $("#flow-step-question").value = step?.question || "";
  $("#flow-step-entity-key").value = step?.entityKey || "";
  $("#flow-step-required").checked = step ? step.required : true;
  $("#flow-step-response").value = step?.responseMessage || "";
  $("#flow-step-max-attempts").value = step?.maxAttempts ?? 3;
  $("#flow-step-active").checked = step ? step.active : true;
  populateFlowStepSelects();
  $("#flow-step-knowledge").value = step?.knowledgeSourceId || "";
  $("#flow-step-tool").value = step?.toolName || "";
  $("#flow-step-next").value = step?.nextStepId || "";
  $("#flow-step-on-success").value = step?.onSuccessStepId || "";
  $("#flow-step-on-failure").value = step?.onFailureStepId || "";
  $("#flow-step-goto").value = step?.gotoStepId || "";
  flowStepFieldVisibility();
  $("#flow-step-form").hidden = false;
  $("#flow-step-name").focus();
}

async function removeFlowStep(stepId) {
  if (!confirm("Remover esta etapa do fluxo?")) return;
  const intentId = $("#intent-id").value;
  try {
    await api(`/api/bots/${state.selected.id}/intents/${intentId}/flow-steps/${stepId}`, { method: "DELETE" });
    toast("Etapa removida.");
    await loadFlowSteps(intentId);
  } catch (error) { toast(error.message, true); }
}

$("#flow-step-action").addEventListener("change", flowStepFieldVisibility);
$("#new-flow-step").addEventListener("click", async () => {
  await Promise.all([ensureToolsLoaded(), ensureKnowledgeSourcesLoaded()]);
  openFlowStepForm();
});
$("#cancel-flow-step").addEventListener("click", closeFlowStepForm);

$("#flow-step-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const intentId = $("#intent-id").value;
  const stepId = $("#flow-step-id").value;
  const payload = {
    name: $("#flow-step-name").value,
    action: $("#flow-step-action").value,
    question: $("#flow-step-question").value || null,
    entityKey: $("#flow-step-entity-key").value || null,
    required: $("#flow-step-required").checked,
    knowledgeSourceId: $("#flow-step-knowledge").value || null,
    toolName: $("#flow-step-tool").value || null,
    responseMessage: $("#flow-step-response").value || null,
    nextStepId: $("#flow-step-next").value || null,
    onSuccessStepId: $("#flow-step-on-success").value || null,
    onFailureStepId: $("#flow-step-on-failure").value || null,
    gotoStepId: $("#flow-step-goto").value || null,
    maxAttempts: Number($("#flow-step-max-attempts").value) || 3,
    active: $("#flow-step-active").checked,
  };
  try {
    const url = stepId
      ? `/api/bots/${state.selected.id}/intents/${intentId}/flow-steps/${stepId}`
      : `/api/bots/${state.selected.id}/intents/${intentId}/flow-steps`;
    await api(url, { method: stepId ? "PATCH" : "POST", body: JSON.stringify(payload) });
    toast(stepId ? "Etapa atualizada." : "Etapa criada.");
    closeFlowStepForm();
    await loadFlowSteps(intentId);
  } catch (error) { toast(error.message, true); }
});

$("#bot-channel").addEventListener("change", () => {
  const checked = Array.from(document.querySelectorAll("#bot-channels-checklist input:checked")).map((input) => input.value);
  renderChannelsChecklist(checked);
});

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

$("#rating-config-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api(`/api/bots/${state.selected.id}/rating-config`, {
      method: "PATCH",
      body: JSON.stringify({
        ratingEnabled: $("#rating-enabled").checked,
        requestRatingComment: $("#rating-request-comment").checked,
        requestRatingOn: $("#rating-request-on").value,
        ratingMessage: $("#rating-message").value || null,
        ratingFollowupMessage: $("#rating-followup").value || null,
      }),
    });
    toast("Configuração de avaliação salva.");
    await selectBot(state.selected.id);
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

function renderSimulatorTranscript() {
  $("#simulator-transcript").innerHTML = state.simulatorHistory.map((entry) => (
    `<div class="transcript-bubble ${entry.direction === "ENVIADA" ? "bot" : "customer"}">${escapeHtml(entry.text)}</div>`
  )).join("");
  const transcript = $("#simulator-transcript");
  transcript.scrollTop = transcript.scrollHeight;
}

function entitiesSummary(entities) {
  const entries = Object.entries(entities || {});
  if (!entries.length) return "Nenhuma";
  return entries.map(([key, value]) => `${key}: ${value}`).join(", ");
}

$("#simulator-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = $("#simulator-message").value;
  if (!message.trim()) return;
  try {
    const result = await api(`/api/bots/${state.selected.id}/simulate`, {
      method: "POST",
      body: JSON.stringify({ message, state: state.simulatorState, history: state.simulatorHistory }),
    });
    state.simulatorHistory.push({ direction: "RECEBIDA", text: message });
    if (result.response) state.simulatorHistory.push({ direction: "ENVIADA", text: result.response });
    state.simulatorState = result.nextState;
    renderSimulatorTranscript();
    $("#simulator-message").value = "";

    $("#simulator-result").innerHTML = `<b>${escapeHtml(result.response || "Sem resposta automática")}</b><div class="result-grid">
      <span>Bot<strong>${escapeHtml(result.botName || "-")}</strong></span>
      <span>Intenção<strong>${escapeHtml(result.intentName || "Nenhuma")}</strong></span>
      <span>Confiança<strong>${result.confidence != null ? `${Math.round(result.confidence * 100)}%` : "-"}</strong></span>
      <span>Ação<strong>${escapeHtml(actionLabels[result.action] || result.action || "-")}</strong></span>
      <span>Categoria<strong>${escapeHtml(result.categoryName || "Nenhuma")}</strong></span>
      <span>Entidades<strong>${escapeHtml(entitiesSummary(result.extractedEntities))}</strong></span>
    </div><p>${escapeHtml(result.warning)}</p>`;
    await renderSimulatorFlowInfo(result.nextState);
  } catch (error) { toast(error.message, true); }
});

// Item 8 (Simulador): mostra intenção/etapa atual/entidades coletadas/
// conhecimento usado/próxima ação do Flow Engine, quando houver um fluxo
// em andamento ou recém-concluído para a última mensagem simulada.
async function renderSimulatorFlowInfo(nextState) {
  const box = document.getElementById("simulator-flow-info");
  if (!box) return;
  if (!nextState?.activeFlowIntentId) { box.hidden = true; box.innerHTML = ""; return; }

  let steps = state.flowStepsCache.get(nextState.activeFlowIntentId);
  if (!steps) {
    try {
      steps = await api(`/api/bots/${state.selected.id}/intents/${nextState.activeFlowIntentId}/flow-steps`);
      state.flowStepsCache.set(nextState.activeFlowIntentId, steps);
    } catch { steps = []; }
  }
  const currentStep = steps.find((step) => step.id === nextState.currentFlowStepId);
  const lastKnowledge = [...(nextState.flowAttemptedSolutions || [])].reverse()
    .find((entry) => entry.action === "USE_KNOWLEDGE" && entry.outcome === "SUCCESS");
  const status = !nextState.currentFlowStepId
    ? (nextState.flowResolutionStatus === "RESOLVED" ? "Resolvido" : nextState.flowResolutionStatus === "HANDED_OFF" ? "Encaminhado para humano" : "Em andamento")
    : "Aguardando resposta do cliente";

  box.hidden = false;
  box.innerHTML = `<b>Fluxo de atendimento</b><div class="result-grid">
    <span>Etapa atual<strong>${escapeHtml(currentStep ? `${currentStep.order}. ${currentStep.name}` : "—")}</strong></span>
    <span>Status<strong>${escapeHtml(status)}</strong></span>
    <span>Entidades coletadas<strong>${escapeHtml(entitiesSummary(nextState.flowCollectedEntities))}</strong></span>
    <span>Conhecimento usado<strong>${escapeHtml(lastKnowledge ? lastKnowledge.name : "Nenhum")}</strong></span>
  </div>`;
}

$("#simulator-clear").addEventListener("click", resetSimulator);

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

function confidenceClass(confidence) {
  if (confidence == null) return "";
  if (confidence >= 0.8) return "obs-confidence-high";
  if (confidence >= 0.55) return "obs-confidence-medium";
  return "obs-confidence-low";
}

function observationDetail(row) {
  const lines = [
    `Provider: ${row.provider || "-"}`,
    `Status: ${row.status || "-"}${row.errorCode ? ` (${row.errorCode})` : ""}`,
    `Comportamento social: ${row.socialBehavior || "Nenhum"}`,
    `Entidades: ${entitiesSummary(row.extractedEntities)}`,
  ];
  return lines.join("\n");
}

const botIntentsCache = new Map();
async function loadBotIntentsCached(botId) {
  if (!botId) return [];
  if (!botIntentsCache.has(botId)) botIntentsCache.set(botId, api(`/api/bots/${encodeURIComponent(botId)}`).then((bot) => bot.intents || []));
  return botIntentsCache.get(botId);
}

function feedbackButtonsHtml(row) {
  return `<div class="obs-feedback" data-obs-feedback="${escapeHtml(row.id)}">
    <button type="button" class="fb-correct ${row.feedback === "CORRECT" ? "active-correct" : ""}">Correto</button>
    <button type="button" class="fb-incorrect ${row.feedback === "INCORRECT" ? "active-incorrect" : ""}">Incorreto</button>
    <span class="fb-status">${row.feedback && row.feedback !== "UNREVIEWED" ? `Marcado como ${row.feedback === "CORRECT" ? "correto" : "incorreto"}` : "Ainda sem revisão"}</span>
  </div><div class="fb-correction" hidden></div>`;
}

async function submitObservationFeedback(observationId, payload, onDone) {
  try {
    await api(`/api/bot-observations/${observationId}/feedback`, { method: "POST", body: JSON.stringify(payload) });
    toast("Feedback registrado.");
    onDone?.();
    await loadObservationMetrics();
  } catch (error) { toast(error.message, true); }
}

function renderObservations(rows) {
  $("#obs-empty").hidden = rows.length > 0;
  $("#obs-table-body").innerHTML = rows.map((row) => `
    <tr class="obs-row" data-obs-id="${escapeHtml(row.id)}">
      <td>${new Date(row.createdAt).toLocaleString("pt-BR")}</td>
      <td>${escapeHtml(row.contact || "-")}</td>
      <td class="obs-message">${escapeHtml(row.message || "-")}</td>
      <td>${escapeHtml(row.botName || "-")}</td>
      <td>${escapeHtml(row.intentName || "Nenhuma")}</td>
      <td class="${confidenceClass(row.confidence)}">${row.confidence != null ? `${Math.round(row.confidence * 100)}%` : "-"}</td>
      <td>${escapeHtml(actionLabels[row.action] || row.action || "-")}</td>
      <td>${escapeHtml(row.categoryName || "-")}</td>
      <td>${escapeHtml(row.status || "-")}</td>
    </tr>
  `).join("");
  document.querySelectorAll(".obs-row").forEach((tr) => tr.addEventListener("click", (event) => {
    if (event.target.closest(".obs-feedback, .fb-correction")) return;
    const next = tr.nextElementSibling;
    if (next?.classList.contains("obs-detail")) { next.remove(); return; }
    document.querySelectorAll(".obs-detail").forEach((detail) => detail.remove());
    const row = rows.find((item) => item.id === tr.dataset.obsId);
    const detailRow = document.createElement("tr");
    detailRow.className = "obs-detail";
    detailRow.innerHTML = `<td colspan="9">${escapeHtml(observationDetail(row))}${feedbackButtonsHtml(row)}</td>`;
    tr.after(detailRow);

    detailRow.querySelector(".fb-correct").addEventListener("click", () => (
      submitObservationFeedback(row.id, { feedback: "CORRECT" }, () => { row.feedback = "CORRECT"; tr.click(); tr.click(); })
    ));
    detailRow.querySelector(".fb-incorrect").addEventListener("click", async () => {
      const box = detailRow.querySelector(".fb-correction");
      if (!box.hidden) { box.hidden = true; return; }
      box.hidden = false;
      const intents = await loadBotIntentsCached(row.botId);
      box.innerHTML = `<label>Intenção correta:
        <select class="fb-intent"><option value="">Selecionar...</option>${intents.map((intent) => (
          `<option value="${escapeHtml(intent.id)}">${escapeHtml(intent.name)}</option>`
        )).join("")}</select>
      </label><label><input type="checkbox" class="fb-add-example" checked><span>Adicionar como exemplo dessa intenção</span></label>
      <button type="button" class="fb-save">Salvar</button>`;
      box.querySelector(".fb-save").addEventListener("click", () => {
        const intentId = box.querySelector(".fb-intent").value;
        if (!intentId) { toast("Selecione a intenção correta.", true); return; }
        submitObservationFeedback(row.id, {
          feedback: "INCORRECT", correctedIntentId: intentId, addAsExample: box.querySelector(".fb-add-example").checked,
        }, () => { row.feedback = "INCORRECT"; tr.click(); tr.click(); });
      });
    });
  }));
}

function metricTile(value, label) {
  return `<div class="metric-tile"><b>${escapeHtml(String(value))}</b><span>${escapeHtml(label)}</span></div>`;
}

async function loadObservationMetrics() {
  try {
    const metrics = await api("/api/bot-observations/metrics");
    $("#obs-metrics").innerHTML = [
      metricTile(metrics.total, "Total analisado"),
      metricTile(metrics.highConfidence, "Alta confiança"),
      metricTile(metrics.mediumConfidence, "Média confiança"),
      metricTile(metrics.lowConfidence, "Baixa confiança"),
      metricTile(metrics.correct, "Corretos"),
      metricTile(metrics.incorrect, "Incorretos"),
      metricTile(metrics.noIntent, "Sem classificação"),
      metricTile(metrics.humanRequests, "Pedidos de humano"),
      metricTile(metrics.accuracy != null ? `${Math.round(metrics.accuracy * 100)}%` : "-", "Precisão (feedback)"),
    ].join("");
  } catch (error) { toast(error.message, true); }
}

async function loadObservations() {
  const params = new URLSearchParams();
  const botId = $("#obs-filter-bot").value;
  const intentName = $("#obs-filter-intent").value.trim();
  const minConfidence = $("#obs-filter-confidence").value;
  const from = $("#obs-filter-from").value;
  const to = $("#obs-filter-to").value;
  if (botId) params.set("botId", botId);
  if (intentName) params.set("intentName", intentName);
  if (minConfidence) params.set("minConfidence", minConfidence);
  if (from) params.set("from", new Date(from).toISOString());
  if (to) params.set("to", new Date(`${to}T23:59:59`).toISOString());
  try {
    const rows = await api(`/api/bot-observations?${params.toString()}`);
    renderObservations(rows);
    await loadObservationMetrics();
  } catch (error) { toast(error.message, true); }
}

const learningTypeLabels = {
  INTENT_EXAMPLE: "Novo exemplo", NEW_INTENT: "Nova intenção", RESPONSE: "Resposta recomendada",
  CLARIFICATION: "Esclarecimento", KNOWLEDGE: "Conhecimento", ENTITY_PATTERN: "Padrão de entidade",
};

function renderLearningSuggestions(rows) {
  $("#learning-empty").hidden = rows.length > 0;
  $("#learning-list").innerHTML = rows.map((row) => `
    <article class="learning-card" data-suggestion-id="${escapeHtml(row.id)}">
      <header>
        <span class="learning-type">${escapeHtml(learningTypeLabels[row.type] || row.type)}</span>
        ${row.metadata?.conflict ? '<span class="learning-conflict">CONFLITO</span>' : ""}
        <span class="learning-meta">${escapeHtml(row.bot?.name || "Sem Bot")} ${row.intent ? `&bull; ${escapeHtml(row.intent.name)}` : ""} &bull; ${row.sourceCount} conversa(s) &bull; ${new Date(row.createdAt).toLocaleDateString("pt-BR")}</span>
      </header>
      <p><b>${escapeHtml(row.title)}</b></p>
      <textarea class="learning-content" ${row.status !== "PENDING" && row.status !== "EDITED" ? "disabled" : ""}>${escapeHtml(row.suggestedContent)}</textarea>
      ${row.status === "PENDING" || row.status === "EDITED" ? `
        <div class="learning-actions">
          ${row.type === "INTENT_EXAMPLE" ? `<select class="learning-intent-select"><option value="">Intenção...</option></select>` : ""}
          <button type="button" class="learning-approve">Aprovar</button>
          <button type="button" class="learning-edit secondary">Salvar edição</button>
          <button type="button" class="learning-reject reject">Ignorar</button>
        </div>` : `<p class="learning-meta">Status: ${escapeHtml(row.status)}</p>`}
    </article>
  `).join("");

  rows.forEach((row) => {
    const card = document.querySelector(`[data-suggestion-id="${row.id}"]`);
    if (!card) return;
    const select = card.querySelector(".learning-intent-select");
    if (select && row.botId) {
      loadBotIntentsCached(row.botId).then((intents) => {
        select.innerHTML = `<option value="">Intenção...</option>${intents.map((intent) => (
          `<option value="${escapeHtml(intent.id)}" ${intent.id === row.intentId ? "selected" : ""}>${escapeHtml(intent.name)}</option>`
        )).join("")}`;
      });
    }
    card.querySelector(".learning-approve")?.addEventListener("click", async () => {
      try {
        const intentId = select ? select.value : undefined;
        await api(`/api/bot-learning/suggestions/${row.id}/approve`, { method: "POST", body: JSON.stringify(intentId ? { intentId } : {}) });
        toast("Sugestão aprovada.");
        await loadLearning();
      } catch (error) { toast(error.message, true); }
    });
    card.querySelector(".learning-edit")?.addEventListener("click", async () => {
      try {
        const content = card.querySelector(".learning-content").value.trim();
        await api(`/api/bot-learning/suggestions/${row.id}`, { method: "PATCH", body: JSON.stringify({ suggestedContent: content }) });
        toast("Sugestão editada. Revise e aprove quando estiver pronta.");
        await loadLearning();
      } catch (error) { toast(error.message, true); }
    });
    card.querySelector(".learning-reject")?.addEventListener("click", async () => {
      try {
        await api(`/api/bot-learning/suggestions/${row.id}/reject`, { method: "POST" });
        toast("Sugestão ignorada.");
        await loadLearning();
      } catch (error) { toast(error.message, true); }
    });
  });
}

async function loadLearningMetrics() {
  try {
    const metrics = await api("/api/bot-learning/metrics");
    $("#learning-metrics").innerHTML = [
      metricTile(metrics.pending, "Pendentes"),
      metricTile(metrics.approved, "Aprovadas"),
      metricTile(metrics.rejected, "Rejeitadas"),
      metricTile(metrics.byType?.INTENT_EXAMPLE || 0, "Novos exemplos"),
      metricTile(metrics.byType?.NEW_INTENT || 0, "Novas intenções"),
    ].join("");
  } catch (error) { toast(error.message, true); }
}

async function loadLearning() {
  const params = new URLSearchParams();
  const status = $("#learning-filter-status").value;
  const type = $("#learning-filter-type").value;
  if (status) params.set("status", status);
  if (type) params.set("type", type);
  try {
    const rows = await api(`/api/bot-learning/suggestions?${params.toString()}`);
    renderLearningSuggestions(rows);
    await loadLearningMetrics();
  } catch (error) { toast(error.message, true); }
}

$("#analyze-conversation").addEventListener("click", async () => {
  const conversationId = $("#analyze-conversation-id").value.trim();
  if (!conversationId) { toast("Informe o ID da conversa.", true); return; }
  try {
    const result = await api(`/api/bot-learning/conversations/${encodeURIComponent(conversationId)}/analyze`, { method: "POST" });
    toast(result.analyzed ? `Análise concluída: ${result.suggestionsGenerated} sugestão(ões).` : `Não analisada: ${result.reason}`);
    await loadLearning();
  } catch (error) { toast(error.message, true); }
});
$("#learning-refresh").addEventListener("click", loadLearning);

function setActiveTab(tab) {
  document.querySelectorAll(".tab-button").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
  $("#observations-panel").hidden = tab !== "observations";
  $("#learning-panel").hidden = tab !== "learning";
  $("#performance-panel").hidden = tab !== "performance";
  $("#versions-panel").hidden = tab !== "versions";
  $("#ranking-panel").hidden = tab !== "ranking";
  if (tab === "config") {
    renderEditor();
    return;
  }
  $("#empty-state").hidden = true;
  $("#editor").hidden = true;
  if (tab === "observations") {
    $("#obs-filter-bot").innerHTML = `<option value="">Todos os Bots</option>${state.bots.map((bot) => (
      `<option value="${escapeHtml(bot.id)}">${escapeHtml(bot.name)}</option>`
    )).join("")}`;
    loadObservations();
  } else if (tab === "learning") {
    loadLearning();
  } else if (tab === "performance") {
    loadPerformance();
  } else if (tab === "versions") {
    loadVersions();
  } else if (tab === "ranking") {
    loadRanking();
  }
}

function requireSelectedBot() {
  if (!state.selected) { toast("Selecione um Bot primeiro.", true); return null; }
  return state.selected.id;
}

async function loadPerformance() {
  const botId = requireSelectedBot();
  if (!botId) return;
  const period = $("#perf-period").value;
  try {
    const [metrics, intentRows, conflicts] = await Promise.all([
      api(`/api/bots/${botId}/rating-metrics?${period ? `preset=${period}` : ""}`),
      api(`/api/bots/${botId}/intent-metrics`),
      api(`/api/bots/${botId}/intent-conflicts`),
    ]);
    $("#perf-interpretation-metrics").innerHTML = [
      metricTile(metrics.interpretation.totalObserved, "Mensagens interpretadas (diagnóstico)"),
      metricTile(metrics.interpretation.handoffs, "Handoffs (interpretador)"),
      metricTile(metrics.interpretation.fallbacks, "Fallbacks (sem intenção)"),
      metricTile(metrics.interpretation.lowConfidence, "Baixa confiança"),
    ].join("");
    $("#perf-attendance-metrics").innerHTML = [
      metricTile(metrics.ratings.total, "Avaliações recebidas"),
      metricTile(metrics.ratings.average ?? "-", "Nota média"),
      metricTile(metrics.ratings.positive, "Ajudou (4-5★)"),
      metricTile(metrics.ratings.neutral, "Neutro (3★)"),
      metricTile(metrics.ratings.negative, "Não ajudou (1-2★)"),
      metricTile(metrics.attendance.resolvedByBot, "Atendimentos concluídos pelo Bot"),
      metricTile(metrics.attendance.handoffOccurred, "Handoffs (avaliados)"),
    ].join("");
    const maxCount = Math.max(1, ...Object.values(metrics.ratings.distribution));
    $("#perf-distribution").innerHTML = [5, 4, 3, 2, 1].map((score) => {
      const count = metrics.ratings.distribution[score] || 0;
      const pct = Math.round((count / maxCount) * 100);
      return `<div class="rating-distribution-row"><span>${score} estrela${score === 1 ? "" : "s"}</span><span class="rating-distribution-bar"><span style="width:${pct}%"></span></span><span>${count}</span></div>`;
    }).join("") + (metrics.ratings.sampleWarning ? `<p class="card-help">${escapeHtml(metrics.ratings.sampleWarning)}</p>` : "");

    $("#intent-metrics-body").innerHTML = intentRows.length ? intentRows.map((row) => `
      <tr><td>${escapeHtml(row.intentName)}</td><td>${row.triggeredCount}</td>
      <td>${row.averageConfidence != null ? `${Math.round(row.averageConfidence * 100)}%` : "-"}</td>
      <td>${row.handoffCount}</td><td>${row.ratingsCount}</td>
      <td>${row.averageRating != null ? row.averageRating : "-"}</td></tr>
    `).join("") : `<tr><td colspan="6">Sem dados ainda.</td></tr>`;

    $("#intent-conflicts-list").innerHTML = conflicts.length ? conflicts.map((conflict) => `
      <article class="learning-card"><p><b>${escapeHtml(conflict.intentAName)}</b> &harr; <b>${escapeHtml(conflict.intentBName)}</b>
      <span class="learning-conflict">${Math.round(conflict.similarity * 100)}% parecidas</span></p>
      <p class="learning-meta">${escapeHtml(conflict.reason)}</p></article>
    `).join("") : `<div class="intent-empty">Nenhum conflito identificado entre as intenções ativas.</div>`;
  } catch (error) { toast(error.message, true); }
}
$("#perf-refresh").addEventListener("click", loadPerformance);

function renderVersions(rows) {
  $("#versions-empty").hidden = rows.length > 0;
  $("#versions-list").innerHTML = rows.map((row) => `
    <article class="learning-card">
      <header><span class="learning-type">v${row.version}</span>
      <span class="learning-meta">${row.createdByName ? escapeHtml(row.createdByName) : "-"} &bull; ${new Date(row.createdAt).toLocaleString("pt-BR")}${row.restoredFromVersion ? ` &bull; restaurada da v${row.restoredFromVersion}` : ""}</span></header>
      <p><b>${escapeHtml(row.label || "Sem rótulo")}</b></p>
      ${row.description ? `<p class="learning-meta">${escapeHtml(row.description)}</p>` : ""}
      <div class="learning-actions"><button type="button" class="restore-version" data-version="${row.version}">Restaurar esta versão</button></div>
    </article>
  `).join("");
  document.querySelectorAll(".restore-version").forEach((button) => button.addEventListener("click", async () => {
    const version = button.dataset.version;
    try {
      const preview = await api(`/api/bots/${state.selected.id}/versions/${version}/preview-restore`);
      const changed = Object.keys(preview.target).filter((key) => JSON.stringify(preview.target[key]) !== JSON.stringify(preview.current[key]));
      const confirmMessage = changed.length
        ? `Restaurar v${version} vai alterar: ${changed.join(", ")}. Isso cria uma nova versão (não apaga o histórico). Confirmar?`
        : `Restaurar v${version}? Isso cria uma nova versão (não apaga o histórico).`;
      if (!confirm(confirmMessage)) return;
      await api(`/api/bots/${state.selected.id}/versions/${version}/restore`, { method: "POST", body: JSON.stringify({}) });
      toast(`Versão restaurada a partir da v${version}.`);
      await loadVersions();
      await selectBot(state.selected.id);
    } catch (error) { toast(error.message, true); }
  }));
}

async function loadVersions() {
  const botId = requireSelectedBot();
  if (!botId) return;
  try {
    renderVersions(await api(`/api/bots/${botId}/versions`));
  } catch (error) { toast(error.message, true); }
}

$("#save-version").addEventListener("click", async () => {
  const botId = requireSelectedBot();
  if (!botId) return;
  try {
    await api(`/api/bots/${botId}/versions`, {
      method: "POST",
      body: JSON.stringify({ label: $("#version-label").value || undefined, description: $("#version-description").value || undefined }),
    });
    toast("Versão salva.");
    $("#version-label").value = ""; $("#version-description").value = "";
    await loadVersions();
  } catch (error) { toast(error.message, true); }
});

async function loadRanking() {
  try {
    const result = await api("/api/bot-ranking");
    $("#ranking-disabled-notice").hidden = result.enabled;
    if (!result.enabled) { $("#ranking-list").innerHTML = ""; $("#ranking-excluded-list").innerHTML = ""; $("#ranking-excluded-heading").hidden = true; return; }
    $("#ranking-list").innerHTML = result.ranked.length ? result.ranked.map((entry, index) => `
      <div class="ranking-card"><span class="ranking-position">${index + 1}</span>
      <div class="ranking-info"><b>${escapeHtml(entry.botName)}</b>
      <small>Nota ${entry.averageScore} &bull; ${entry.ratingsCount} avaliação(ões) &bull; score ${entry.rankingScore}</small></div></div>
    `).join("") : `<div class="intent-empty">Nenhum Bot atingiu a amostra mínima ainda.</div>`;
    $("#ranking-excluded-heading").hidden = result.excluded.length === 0;
    $("#ranking-excluded-list").innerHTML = result.excluded.map((entry) => `
      <div class="ranking-card"><span class="ranking-position">-</span>
      <div class="ranking-info"><b>${escapeHtml(entry.botName)}</b>
      <small>${entry.ratingsCount}/${result.minimumRatingsForRanking} avaliações &bull; Dados insuficientes para ranking</small></div></div>
    `).join("");
  } catch (error) { toast(error.message, true); }
}

async function loadGlobalSettings() {
  try {
    const settings = await api("/api/bot-settings");
    $("#global-automation").checked = settings.automationEnabled;
    $("#global-observation").checked = settings.observationEnabled;
    $("#global-learning").checked = settings.learningEnabled;
    $("#global-ratings").checked = settings.ratingsEnabled;
    $("#global-ranking").checked = settings.rankingEnabled;
    $("#global-min-ratings").value = settings.minimumRatingsForRanking;
    const pill = $("#global-automation-status");
    pill.textContent = settings.automationEnabled ? "AUTOMAÇÃO ON" : "AUTOMAÇÃO OFF";
    pill.className = `global-status-pill ${settings.automationEnabled ? "on" : "off"}`;
    const killSwitch = $("#kill-switch");
    killSwitch.dataset.automationEnabled = String(settings.automationEnabled);
    killSwitch.textContent = settings.automationEnabled
      ? "DESATIVAR AUTOMAÇÃO DOS BOTS"
      : "REATIVAR AUTOMAÇÃO DOS BOTS";
  } catch (error) { toast(error.message, true); }
}

$("#save-global-settings").addEventListener("click", async () => {
  try {
    await api("/api/bot-settings", {
      method: "PATCH",
      body: JSON.stringify({
        observationEnabled: $("#global-observation").checked,
        learningEnabled: $("#global-learning").checked,
        ratingsEnabled: $("#global-ratings").checked,
        rankingEnabled: $("#global-ranking").checked,
        minimumRatingsForRanking: Number($("#global-min-ratings").value),
      }),
    });
    toast("Configurações globais salvas.");
    await loadGlobalSettings();
  } catch (error) { toast(error.message, true); }
});

$("#kill-switch").addEventListener("click", async () => {
  const willActivate = $("#kill-switch").dataset.automationEnabled === "true";
  const action = willActivate ? "desativar" : "reativar";
  if (!confirm(`Tem certeza que deseja ${action} a automação de TODOS os Bots agora? Atendimento humano e recebimento de mensagens continuam funcionando normalmente.`)) return;
  try {
    if (willActivate) await api("/api/bot-settings/kill-switch/activate", { method: "POST" });
    else await api("/api/bot-settings/kill-switch/deactivate", { method: "POST" });
    toast(willActivate ? "Automação dos Bots desativada." : "Automação dos Bots reativada.");
    await loadGlobalSettings();
  } catch (error) { toast(error.message, true); }
});

document.querySelectorAll(".tab-button").forEach((button) => button.addEventListener("click", () => setActiveTab(button.dataset.tab)));
$("#obs-refresh").addEventListener("click", loadObservations);

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
    await loadGlobalSettings();
  } catch (error) {
    if ($("#bot-list").querySelector(".skeleton-list")) $("#bot-list").innerHTML = `<div class="empty-list">Não foi possível carregar os bots.</div>`;
    toast(error.message, true);
  }
})();
