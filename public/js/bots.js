const state = {
  bots: [], categories: [], selected: null,
  simulatorHistory: [], simulatorState: null,
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

function fillBotForm(bot = null) {
  $("#bot-name").value = bot?.name || "";
  $("#bot-description").value = bot?.description || "";
  $("#bot-channel").value = bot?.channel || "META";
  $("#bot-timezone").value = bot?.timezone || "America/Sao_Paulo";
  $("#bot-category").innerHTML = categoryOptions(bot?.defaultCategoryId || "");
  $("#bot-low-confidence").value = bot?.lowConfidenceThreshold ?? 0.55;
  $("#bot-high-confidence").value = bot?.highConfidenceThreshold ?? 0.8;
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

function resetSimulator() {
  state.simulatorHistory = [];
  state.simulatorState = null;
  $("#simulator-transcript").innerHTML = "";
  $("#simulator-result").innerHTML = "<p>O resultado da simulação aparecerá aqui.</p>";
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
  return {
    name: $("#bot-name").value,
    description: $("#bot-description").value,
    channel: $("#bot-channel").value,
    timezone: $("#bot-timezone").value,
    defaultCategoryId: $("#bot-category").value || null,
    lowConfidenceThreshold: Number($("#bot-low-confidence").value),
    highConfidenceThreshold: Number($("#bot-high-confidence").value),
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
  } catch (error) { toast(error.message, true); }
});

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
  }
}

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
  } catch (error) { toast(error.message, true); }
})();
