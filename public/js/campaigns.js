const state = {
  campaigns: [], selected: null, templates: [], categories: [], bots: [],
  importHeaders: [], importCsvText: "", importFileName: "", importErrors: [],
};
const $ = (selector) => document.querySelector(selector);

const statusLabels = {
  DRAFT: "RASCUNHO", SCHEDULED: "AGENDADA", QUEUED: "NA FILA", RUNNING: "EM ENVIO",
  PAUSED: "PAUSADA", COMPLETED: "CONCLUÍDA", CANCELLED: "CANCELADA", FAILED: "FALHOU",
};

async function api(url, options = {}) {
  const isForm = options.body instanceof FormData;
  const headers = { ...(options.body && !isForm ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) };
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) { location.replace("/login.html"); throw new Error("Sessão encerrada."); }
  if (response.headers.get("content-type")?.includes("text/csv")) return response;
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

function metricTile(value, label) {
  return `<div class="metric-tile"><b>${escapeHtml(value ?? "-")}</b><span>${escapeHtml(label)}</span></div>`;
}

// ===== Lista de campanhas =====

async function loadCampaigns() {
  const status = $("#campaign-status-filter").value;
  state.campaigns = await api(`/api/campaigns${status ? `?status=${status}` : ""}`);
  renderCampaignList();
}

function renderCampaignList() {
  $("#campaign-count").textContent = `${state.campaigns.length} campanha(s)`;
  $("#campaign-list").innerHTML = state.campaigns.length ? state.campaigns.map((campaign) => `
    <button class="bot-card ${state.selected?.id === campaign.id ? "active" : ""}" type="button" data-campaign-id="${escapeHtml(campaign.id)}">
      <header><b>${escapeHtml(campaign.name)}</b><span class="mini-status ${campaign.status}">${statusLabels[campaign.status]}</span></header>
      <small>${escapeHtml(campaign.templateName)}</small>
      <div class="bot-meta"><span>${campaign._count.contacts} contato(s)</span></div>
    </button>
  `).join("") : '<div class="intent-empty">Nenhuma campanha criada.</div>';
  document.querySelectorAll("[data-campaign-id]").forEach((button) => button.addEventListener("click", () => selectCampaign(button.dataset.campaignId)));
}

async function ensureTemplatesLoaded() {
  try {
    state.templates = await api("/api/campaign-templates");
    $("#campaign-template").innerHTML = `<option value="">Selecione um template aprovado</option>${state.templates.map((template) => (
      `<option value="${escapeHtml(template.name)}|${escapeHtml(template.language)}">${escapeHtml(template.name)} (${escapeHtml(template.language)}) — ${escapeHtml(template.category)}</option>`
    )).join("")}`;
  } catch (error) {
    $("#campaign-template").innerHTML = `<option value="">Templates da Meta indisponíveis</option>`;
    toast(error.message, true);
  }
}

async function ensureCategoriesAndBotsLoaded() {
  try {
    state.categories = await api("/api/categories");
    $("#campaign-reply-category").innerHTML = `<option value="">Sem categoria automática</option>${state.categories.map((category) => (
      `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>`
    )).join("")}`;
  } catch { /* categorias são opcionais nesta tela */ }
  try {
    state.bots = await api("/api/bots");
    $("#campaign-reply-bot").innerHTML = `<option value="">Nenhum</option>${state.bots.map((bot) => (
      `<option value="${escapeHtml(bot.id)}">${escapeHtml(bot.name)}</option>`
    )).join("")}`;
  } catch { /* bots são opcionais nesta tela */ }
}

function renderVariableMapping(template, existingMapping = {}) {
  if (!template) { $("#campaign-variables").innerHTML = ""; return; }
  $("#campaign-variables").innerHTML = `<div class="fields-heading">MAPEAMENTO DE VARIÁVEIS</div>` + template.variables.map((variable) => `
    <label><span>${escapeHtml(variable.label)}</span>
      <select data-variable-key="${escapeHtml(variable.key)}">
        <option value="">Usar exemplo (${escapeHtml(variable.example || "—")})</option>
        <option value="firstName">Primeiro nome</option>
        <option value="fullName">Nome completo</option>
        <option value="companyName">Empresa</option>
        <option value="city">Cidade</option>
        <option value="state">UF</option>
        <option value="static:">Texto fixo…</option>
      </select>
    </label>
  `).join("");
  for (const select of document.querySelectorAll("[data-variable-key]")) {
    const key = select.dataset.variableKey;
    const value = existingMapping[key];
    if (value && ["firstName", "fullName", "companyName", "city", "state"].includes(value)) select.value = value;
    else if (typeof value === "string" && value.startsWith("static:")) select.value = "static:";
  }
}

function selectedTemplate() {
  const [name, language] = ($("#campaign-template").value || "").split("|");
  return state.templates.find((template) => template.name === name && template.language === language);
}

function currentVariableMapping() {
  const mapping = {};
  for (const select of document.querySelectorAll("[data-variable-key]")) {
    mapping[select.dataset.variableKey] = select.value || undefined;
  }
  return mapping;
}

$("#campaign-template").addEventListener("change", () => renderVariableMapping(selectedTemplate()));

// ===== Editor =====

function resetEditor() {
  $("#campaign-name").value = ""; $("#campaign-category").value = ""; $("#campaign-description").value = "";
  $("#campaign-template").value = ""; $("#campaign-variables").innerHTML = "";
  $("#campaign-reply-category").value = ""; $("#campaign-reply-bot").value = "";
  $("#campaign-test-phone").value = ""; $("#campaign-batch-size").value = "";
}

function fillEditor(campaign) {
  $("#campaign-name").value = campaign.name;
  $("#campaign-category").value = campaign.category || "";
  $("#campaign-description").value = campaign.description || "";
  $("#campaign-template").value = `${campaign.templateName}|${campaign.templateLanguage}`;
  renderVariableMapping(selectedTemplate(), campaign.variableMapping || {});
  $("#campaign-reply-category").value = campaign.replyCategoryId || "";
  $("#campaign-reply-bot").value = campaign.replyBotId || "";
  $("#campaign-test-phone").value = campaign.testPhone || "";
  $("#campaign-batch-size").value = campaign.batchSize || "";
}

async function selectCampaign(id) {
  state.selected = await api(`/api/campaigns/${id}`);
  renderEditor();
  await Promise.all([loadMetrics(), loadContacts()]);
}

function renderEditor() {
  const campaign = state.selected;
  $("#empty-state").hidden = Boolean(campaign) || $("#editor").dataset.creating === "true";
  $("#editor").hidden = !campaign && $("#editor").dataset.creating !== "true";
  if (!campaign) return;
  $("#editor").dataset.creating = "false";
  $("#editor-eyebrow").textContent = "CAMPANHA SELECIONADA";
  $("#editor-title").textContent = campaign.name;
  $("#editor-description").textContent = campaign.description || "Sem descrição.";
  $("#status-actions").hidden = false;
  $("#status-badge").textContent = statusLabels[campaign.status];
  document.querySelectorAll(".requires-bot").forEach((element) => { element.hidden = false; });
  fillEditor(campaign);
  renderCampaignList();
}

function startNewCampaign() {
  state.selected = null;
  $("#editor").dataset.creating = "true";
  $("#empty-state").hidden = true;
  $("#editor").hidden = false;
  $("#editor-eyebrow").textContent = "NOVA CAMPANHA";
  $("#editor-title").textContent = "Criar campanha";
  $("#editor-description").textContent = "Selecione um template aprovado e configure o público.";
  $("#status-actions").hidden = true;
  document.querySelectorAll(".requires-bot").forEach((element) => { element.hidden = true; });
  resetEditor();
  renderCampaignList();
}

$("#new-campaign").addEventListener("click", startNewCampaign);
$("#empty-new-campaign").addEventListener("click", startNewCampaign);
$("#campaign-status-filter").addEventListener("change", loadCampaigns);

$("#campaign-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const [templateName, templateLanguage] = ($("#campaign-template").value || "").split("|");
  if (!templateName) { toast("Selecione um template aprovado.", true); return; }
  const payload = {
    name: $("#campaign-name").value,
    category: $("#campaign-category").value || null,
    description: $("#campaign-description").value || null,
    templateName, templateLanguage,
    variableMapping: currentVariableMapping(),
    replyCategoryId: $("#campaign-reply-category").value || null,
    replyBotId: $("#campaign-reply-bot").value || null,
    testPhone: $("#campaign-test-phone").value || null,
    batchSize: $("#campaign-batch-size").value || null,
  };
  try {
    if (state.selected) {
      state.selected = await api(`/api/campaigns/${state.selected.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      toast("Campanha atualizada.");
    } else {
      state.selected = await api("/api/campaigns", { method: "POST", body: JSON.stringify(payload) });
      toast("Campanha criada.");
    }
    await loadCampaigns();
    renderEditor();
  } catch (error) { toast(error.message, true); }
});

$("#campaign-preview-button").addEventListener("click", async () => {
  const [templateName, templateLanguage] = ($("#campaign-template").value || "").split("|");
  if (!templateName) { toast("Selecione um template.", true); return; }
  try {
    const preview = await api("/api/campaign-templates/preview", {
      method: "POST", body: JSON.stringify({ templateName, templateLanguage, variableMapping: currentVariableMapping() }),
    });
    $("#campaign-preview").innerHTML = `<p>${escapeHtml(preview.renderedPreview).replace(/\n/g, "<br>")}</p>`;
  } catch (error) { toast(error.message, true); }
});

// ===== Ações do ciclo de vida =====

async function runCampaignAction(action, extra) {
  if (!state.selected) return;
  try {
    state.selected = await api(`/api/campaigns/${state.selected.id}/${action}`, { method: "POST", body: extra ? JSON.stringify(extra) : undefined });
    toast("Ação realizada.");
    await loadCampaigns();
    renderEditor();
  } catch (error) { toast(error.message, true); }
}
$("#campaign-schedule").addEventListener("click", () => runCampaignAction("schedule", { scheduledAt: $("#campaign-scheduled-at").value || null }));
$("#campaign-queue-now").addEventListener("click", () => runCampaignAction("queue-now"));
$("#campaign-pause").addEventListener("click", () => runCampaignAction("pause"));
$("#campaign-resume").addEventListener("click", () => runCampaignAction("resume"));
$("#campaign-cancel").addEventListener("click", () => { if (confirm("Cancelar esta campanha? Os contatos ainda não enviados serão ignorados.")) runCampaignAction("cancel"); });
$("#campaign-send-test").addEventListener("click", async () => {
  if (!state.selected) return;
  try {
    await api(`/api/campaigns/${state.selected.id}/send-test`, { method: "POST" });
    toast("Mensagem de teste enviada — não conta como campanha real.");
  } catch (error) { toast(error.message, true); }
});

// ===== Importação =====

$("#import-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file || !state.selected) return;
  state.importFileName = file.name;
  state.importCsvText = await file.text();
  const form = new FormData();
  form.append("file", file);
  try {
    const preview = await api(`/api/campaigns/${state.selected.id}/import/parse`, { method: "POST", body: form });
    state.importHeaders = preview.headers;
    $("#import-mapping").hidden = false;
    $("#import-mapping-fields").innerHTML = ["phone", "firstName", "fullName", "email", "companyName", "document", "city", "state", "source", "tags", "notes"].map((field) => `
      <label><span>${escapeHtml(field)}${field === "phone" ? " *" : ""}</span>
        <select data-import-field="${field}">
          <option value="">Não importar</option>
          ${preview.headers.map((header, index) => `<option value="${index}">${escapeHtml(header)}</option>`).join("")}
        </select>
      </label>
    `).join("");
    $("#import-summary").innerHTML = "";
    $("#import-commit").hidden = true;
    $("#import-download-errors").hidden = true;
  } catch (error) { toast(error.message, true); }
});

function currentImportMapping() {
  const mapping = {};
  for (const select of document.querySelectorAll("[data-import-field]")) {
    if (select.value !== "") mapping[select.dataset.importField] = select.value;
  }
  return mapping;
}

$("#import-validate").addEventListener("click", async () => {
  if (!state.selected) return;
  const mapping = currentImportMapping();
  if (!mapping.phone) { toast("Mapeie a coluna de telefone (obrigatória).", true); return; }
  try {
    const result = await api(`/api/campaigns/${state.selected.id}/import/validate`, {
      method: "POST", body: JSON.stringify({ csvText: state.importCsvText, mapping }),
    });
    state.importErrors = result.errors || [];
    $("#import-summary").innerHTML = [
      metricTile(result.totalRows, "Total"), metricTile(result.validRows, "Válidas"),
      metricTile(result.invalidRows, "Inválidas"), metricTile(result.duplicateRows, "Duplicadas"),
      metricTile(result.optOutRows, "Opt-out"), metricTile(result.alreadyInCampaignRows, "Já na campanha"),
    ].join("");
    $("#import-commit").hidden = result.validRows === 0;
    $("#import-download-errors").hidden = !state.importErrors.length;
  } catch (error) { toast(error.message, true); }
});

$("#import-commit").addEventListener("click", async () => {
  if (!state.selected) return;
  try {
    const mapping = currentImportMapping();
    const result = await api(`/api/campaigns/${state.selected.id}/import/commit`, {
      method: "POST", body: JSON.stringify({ csvText: state.importCsvText, mapping, fileName: state.importFileName }),
    });
    toast(`${result.validRows} contato(s) importado(s).`);
    $("#import-file").value = "";
    $("#import-mapping").hidden = true;
    await selectCampaign(state.selected.id);
  } catch (error) { toast(error.message, true); }
});

$("#import-download-errors").addEventListener("click", () => {
  const header = "linha,motivo,valor\n";
  const rows = state.importErrors.map((error) => `${error.row},${error.reason},"${(error.value || "").replace(/"/g, '""')}"`).join("\n");
  const blob = new Blob([header + rows], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = "erros-importacao.csv"; link.click();
  URL.revokeObjectURL(url);
});

// ===== Segmentação/público =====

$("#estimate-audience").addEventListener("click", async () => {
  if (!state.selected) return;
  const filters = {
    city: $("#segment-city").value || undefined, state: $("#segment-state").value || undefined,
    companyName: $("#segment-company").value || undefined, source: $("#segment-source").value || undefined,
  };
  try {
    const result = await api(`/api/campaigns/${state.selected.id}/estimate-audience`, { method: "POST", body: JSON.stringify(filters) });
    $("#audience-result").innerHTML = metricTile(result.count, "Contatos elegíveis");
  } catch (error) { toast(error.message, true); }
});

// ===== Métricas e destinatários =====

async function loadMetrics() {
  if (!state.selected) return;
  try {
    const metrics = await api(`/api/campaigns/${state.selected.id}/metrics`);
    $("#campaign-metrics").innerHTML = [
      metricTile(metrics.total, "Total"), metricTile(metrics.eligible, "Elegíveis"), metricTile(metrics.queued, "Na fila"),
      metricTile(metrics.sent, "Enviados"), metricTile(metrics.delivered, "Entregues"), metricTile(metrics.read, "Lidos"),
      metricTile(metrics.replied, "Responderam"), metricTile(metrics.failed, "Falharam"), metricTile(metrics.optOut, "Opt-out"),
      metricTile(metrics.deliveryRate != null ? `${metrics.deliveryRate}%` : "-", "Taxa de entrega"),
      metricTile(metrics.readRate != null ? `${metrics.readRate}%` : "-", "Taxa de leitura"),
      metricTile(metrics.replyRate != null ? `${metrics.replyRate}%` : "-", "Taxa de resposta"),
    ].join("");
  } catch (error) { toast(error.message, true); }
}
$("#refresh-metrics").addEventListener("click", loadMetrics);

async function loadContacts() {
  if (!state.selected) return;
  const status = $("#contacts-status-filter").value;
  try {
    const result = await api(`/api/campaigns/${state.selected.id}/contacts?${status ? `status=${status}&` : ""}limit=50`);
    $("#contacts-body").innerHTML = result.rows.length ? result.rows.map((row) => `
      <tr><td>${escapeHtml(row.phone)}</td><td>${escapeHtml(row.fullName || row.firstName || "-")}</td>
      <td>${escapeHtml(row.status)}</td><td>${escapeHtml(row.prospectStatus)}</td>
      <td>${row.sentAt ? new Date(row.sentAt).toLocaleString("pt-BR") : "-"}</td>
      <td>${escapeHtml(row.failureReason || "-")}</td></tr>
    `).join("") : `<tr><td colspan="6">Nenhum contato.</td></tr>`;
  } catch (error) { toast(error.message, true); }
}
$("#contacts-status-filter").addEventListener("change", loadContacts);
$("#export-contacts").addEventListener("click", () => {
  if (!state.selected) return;
  const status = $("#contacts-status-filter").value;
  const map = { PENDING: "all", SENT: "sent", DELIVERED: "delivered", READ: "read", REPLIED: "replied", FAILED: "failed", OPTED_OUT: "optOut", SKIPPED: "all" };
  window.open(`/api/campaigns/${state.selected.id}/export?filter=${map[status] || "all"}`, "_blank");
});

// ===== Configurações globais =====

$("#campaign-settings-button").addEventListener("click", async () => {
  try {
    const settings = await api("/api/campaign-settings");
    $("#setting-mass-enabled").checked = settings.massMessagingEnabled;
    $("#setting-allow-scheduling").checked = settings.allowScheduling;
    $("#setting-allow-imports").checked = settings.allowImports;
    $("#setting-max-recipients").value = settings.maxCampaignRecipients;
    $("#setting-batch-size").value = settings.defaultBatchSize;
    $("#setting-delay").value = settings.defaultDelayBetweenBatchesSeconds;
    $("#setting-max-retries").value = settings.defaultMaxRetries;
    $("#settings-modal").hidden = false;
  } catch (error) { toast(error.message, true); }
});
$("#close-settings").addEventListener("click", () => { $("#settings-modal").hidden = true; });
$("#save-settings").addEventListener("click", async () => {
  try {
    await api("/api/campaign-settings", { method: "PATCH", body: JSON.stringify({
      massMessagingEnabled: $("#setting-mass-enabled").checked,
      allowScheduling: $("#setting-allow-scheduling").checked,
      allowImports: $("#setting-allow-imports").checked,
      maxCampaignRecipients: Number($("#setting-max-recipients").value),
      defaultBatchSize: Number($("#setting-batch-size").value),
      defaultDelayBetweenBatchesSeconds: Number($("#setting-delay").value),
      defaultMaxRetries: Number($("#setting-max-retries").value),
    }) });
    toast("Configurações salvas.");
    $("#settings-modal").hidden = true;
  } catch (error) { toast(error.message, true); }
});

// ===== Opt-out =====

$("#campaign-optouts-button").addEventListener("click", async () => {
  try {
    const rows = await api("/api/campaign-opt-outs?active=true");
    $("#optouts-list").innerHTML = `<table class="observations-table"><thead><tr><th>Telefone</th><th>Origem</th><th>Data</th><th></th></tr></thead><tbody>${
      rows.length ? rows.map((row) => `
        <tr><td>${escapeHtml(row.phone)}</td><td>${escapeHtml(row.source)}</td>
        <td>${new Date(row.createdAt).toLocaleDateString("pt-BR")}</td>
        <td><button type="button" data-remove-optout="${escapeHtml(row.phone)}">Remover</button></td></tr>
      `).join("") : '<tr><td colspan="4">Nenhum opt-out ativo.</td></tr>'
    }</tbody></table>`;
    document.querySelectorAll("[data-remove-optout]").forEach((button) => button.addEventListener("click", async () => {
      const reason = prompt("Motivo da remoção do opt-out:");
      if (!reason) return;
      try {
        await api(`/api/campaign-opt-outs/${button.dataset.removeOptout}/remove`, { method: "POST", body: JSON.stringify({ reason }) });
        toast("Opt-out removido.");
        $("#campaign-optouts-button").click();
      } catch (error) { toast(error.message, true); }
    }));
    $("#optouts-modal").hidden = false;
  } catch (error) { toast(error.message, true); }
});
$("#close-optouts").addEventListener("click", () => { $("#optouts-modal").hidden = true; });

// ===== Boot =====

$("#theme-toggle").addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme !== "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  try { localStorage.setItem("mibro-theme", dark ? "dark" : "light"); } catch { /* ignore */ }
  $("#theme-toggle").textContent = dark ? "☾" : "☀";
});
$("#logout").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" });
  location.href = "/login.html";
});

(async function boot() {
  try {
    const status = await api("/api/auth/status");
    $("#current-user").textContent = status.user.name;
    await Promise.all([ensureTemplatesLoaded(), ensureCategoriesAndBotsLoaded(), loadCampaigns()]);
  } catch (error) { toast(error.message, true); }
})();
