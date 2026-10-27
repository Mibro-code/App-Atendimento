const $ = (selector) => document.querySelector(selector);
const MARKETPLACE_UI_ENABLED = window.MIBRO_FEATURES?.marketplaces !== false;
const isMarketplaceChannel = (channel) => window.isMarketplaceFeatureChannel?.(channel) === true;
const visibleChannelEntries = () => Object.entries(CHANNEL_LABELS).filter(([channel]) => MARKETPLACE_UI_ENABLED || !isMarketplaceChannel(channel));
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[char]);
// listStatus: loading | ready | error | forbidden — erro de API nunca vira
// "lista vazia". Os contadores de sequência descartam respostas atrasadas.
const state = { quickReplies: [], categories: [], selected: null, listStatus: "loading", listError: "", listSeq: 0, selectSeq: 0, previewSeq: 0, busy: false };

const CHANNEL_LABELS = {
  META: "WhatsApp (Meta)", INSTAGRAM_DIRECT: "Instagram Direct", INSTAGRAM_COMMENTS: "Instagram Comentários",
  FACEBOOK_MESSENGER: "Facebook Messenger", FACEBOOK_COMMENTS: "Facebook Comentários", EMAIL: "E-mail",
  MERCADO_LIVRE: "Mercado Livre", TIKTOK_SHOP: "TikTok Shop", AMAZON_MARKETPLACE: "Amazon Marketplace",
  SHOPEE: "Shopee", GOOGLE_REVIEWS: "Google Reviews / Perfil da Empresa", RECLAME_AQUI: "Reclame Aqui",
};

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
  element.className = `toast show${error ? " error" : ""}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { element.className = "toast"; }, 3200);
}

// Uma ação por vez nos botões do editor: evita PATCH/DELETE duplicados por
// duplo clique e mostra que o clique foi recebido.
async function withBusy(button, label, action) {
  if (state.busy) return;
  state.busy = true;
  const original = button?.textContent;
  if (button) { button.disabled = true; button.textContent = label; }
  try { return await action(); }
  finally {
    state.busy = false;
    if (button) { button.disabled = false; button.textContent = original; }
  }
}

function renderCategoriesChecklist(selected = []) {
  const selectedIds = new Set(selected);
  const companyId = $("#qr-company").value;
  const categories = state.categories.filter((category) => companyId !== "GLOBAL" && category.companyId === companyId);
  const parentsWithChildren = new Set(categories.filter((category) => category.parentId).map((category) => category.parentId));
  $("#qr-categories-checklist").innerHTML = categories.length ? categories.map((category) => `
    <label class="qr-category-option ${category.parentId ? "child" : "parent"}">
      <input type="checkbox" value="${escapeHtml(category.id)}" ${selectedIds.has(category.id) ? "checked" : ""}>
      <span>${escapeHtml(category.name)}</span>
      ${parentsWithChildren.has(category.id) ? '<small>inclui subcategorias</small>' : ""}
    </label>
  `).join("") : `<p class="card-help">${companyId === "GLOBAL" ? "Resposta global vale para todos os setores." : "Selecione a empresa para escolher setores."}</p>`;
}

function currentFilters() {
  return {
    search: $("#qr-search").value.trim(),
    categoryId: $("#qr-filter-category").value,
    channel: $("#qr-filter-channel").value,
    active: $("#qr-filter-active").value,
    includeArchived: "false",
    ...(state.companyFilter && state.companyFilter !== "ALL" ? { company: state.companyFilter } : {}),
  };
}
const hasActiveFilters = () => Boolean($("#qr-search").value.trim() || $("#qr-filter-category").value || $("#qr-filter-channel").value || $("#qr-filter-active").value || (state.companyFilter && state.companyFilter !== "ALL"));

// Multiempresa (item 31): "Vale para" = Todas as empresas (GLOBAL) ou uma
// empresa (COMPANY). Setor é sempre de uma empresa — resposta global não
// tem setor. Respostas antigas viraram "Mibro" na migração; promova a
// global só as genéricas.
function renderCompanyOptions(item = null) {
  const value = item ? (item.scope === "GLOBAL" ? "GLOBAL" : item.companyId || "") : (window.CompanyContext.companies.find((company) => company.slug === state.companyFilter)?.id || "");
  $("#qr-company").innerHTML = `<option value="GLOBAL">Todas as empresas (global)</option>${window.CompanyContext.companies.map((company) => (
    `<option value="${escapeHtml(company.id)}">${escapeHtml(company.name)}</option>`
  )).join("")}`;
  $("#qr-company").value = value || (window.CompanyContext.multi() ? "" : window.CompanyContext.companies[0]?.id || "GLOBAL");
  if (!$("#qr-company").value) $("#qr-company").selectedIndex = -1;
  renderCategoriesChecklist(item?.categoryIds || (item?.categoryId ? [item.categoryId] : []));
}

function renderFilterOptions() {
  $("#qr-filter-category").innerHTML = `<option value="">Todas as categorias</option>${state.categories.map((category) => (
    `<option value="${escapeHtml(category.id)}">${escapeHtml(category.parentId ? `- ${category.name}` : category.name)}</option>`
  )).join("")}`;
  $("#qr-filter-channel").innerHTML = `<option value="">Todos os canais</option>${visibleChannelEntries().map(([value, label]) => (
    `<option value="${value}">${escapeHtml(label)}</option>`
  )).join("")}`;
}

function listStateMarkup() {
  if (state.listStatus === "loading") return '<div class="skeleton-list" aria-label="Carregando respostas rápidas"><div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div></div>';
  if (state.listStatus === "forbidden") return '<div class="qr-list-state error" role="alert"><b>Acesso restrito</b><p>Seu usuário não tem permissão para gerenciar respostas rápidas.</p></div>';
  if (state.listStatus === "error") return `<div class="qr-list-state error" role="alert"><b>Não foi possível carregar as respostas rápidas.</b><p>${escapeHtml(state.listError)}</p><button type="button" data-qr-retry>Tentar novamente</button></div>`;
  if (hasActiveFilters()) return '<div class="qr-list-state"><b>Nenhuma resposta encontrada</b><p>Nenhum resultado para a busca ou os filtros atuais.</p><button type="button" data-qr-clear-filters>Limpar filtros</button></div>';
  return '<div class="qr-list-state"><b>Nenhuma resposta rápida cadastrada.</b><p>Use “+ Nova” para criar a primeira.</p></div>';
}

function quickReplyCardMarkup(item) {
  const categories = item.categories?.length ? item.categories.map((category) => category.name).join(", ") : (item.category?.name || "Todos os setores");
  const channels = item.channels?.length ? item.channels.map((channel) => CHANNEL_LABELS[channel] || channel).join(", ") : "Todos os canais";
  const preview = item.contentType === "AUDIO" ? "🎤 Resposta em áudio" : (item.text || "").replace(/\s+/g, " ").trim();
  const active = state.selected?.id === item.id;
  return `
    <button class="bot-card qr-card ${active ? "active" : ""}" type="button" data-qr-id="${escapeHtml(item.id)}" ${active ? 'aria-current="true"' : ""}>
      <header><b>${escapeHtml(item.name)}</b>${item.scope === "GLOBAL" ? `<span class="company-badge">GLOBAL</span>` : window.CompanyContext.badge(item.company)}<span class="mini-status ${item.active ? "ACTIVE" : "PAUSED"}">${item.active ? "ATIVA" : "INATIVA"}</span></header>
      <small class="qr-shortcut-pill">${escapeHtml(item.shortcut)}</small>
      <p class="qr-card-preview">${escapeHtml(preview || "Sem conteúdo")}</p>
      <div class="bot-meta"><span>${escapeHtml(categories)}</span><span>•</span><span>${escapeHtml(channels)}</span><span>•</span><span>${item.usageCount} uso(s)</span></div>
    </button>`;
}

function renderList() {
  const count = state.quickReplies.length;
  $("#qr-count").textContent = state.listStatus === "ready"
    ? `${count} resposta${count === 1 ? "" : "s"} ${hasActiveFilters() ? "encontrada" : "configurada"}${count === 1 ? "" : "s"}`
    : state.listStatus === "loading" ? "Carregando..." : "Lista indisponível";
  $("#qr-list").setAttribute("aria-busy", String(state.listStatus === "loading"));
  $("#qr-list").innerHTML = state.listStatus === "ready" && count ? state.quickReplies.map(quickReplyCardMarkup).join("") : listStateMarkup();
}

async function loadList() {
  const seq = ++state.listSeq;
  if (state.listStatus !== "ready") { state.listStatus = "loading"; renderList(); }
  try {
    const rows = await api(`/api/quick-replies?${new URLSearchParams(currentFilters())}`);
    if (seq !== state.listSeq) return;
    state.quickReplies = Array.isArray(rows) ? rows : [];
    state.listStatus = "ready";
  } catch (error) {
    if (seq !== state.listSeq) return;
    state.quickReplies = [];
    state.listStatus = error.status === 403 ? "forbidden" : "error";
    state.listError = error.message;
  }
  renderList();
}

function renderChannelsChecklist(selected = []) {
  $("#qr-channels-checklist").innerHTML = visibleChannelEntries().map(([value, label]) => `
    <label class="checkbox"><input type="checkbox" value="${value}" ${selected.includes(value) ? "checked" : ""}><span>${label}</span></label>
  `).join("");
}

// Intenções vêm dos Bots antigos (a listagem /api/bots/intents saiu com o
// Flow Builder). Mostra só as já vinculadas, para poder desvincular; sem
// vínculo, o campo some e o salvar não mexe nelas.
function renderIntentsChecklist(item = null) {
  const intents = item?.intents || [];
  $("#qr-intents-field").hidden = !intents.length;
  $("#qr-intents-checklist").innerHTML = intents.map((intent) => `
    <label class="checkbox"><input type="checkbox" value="${escapeHtml(intent.id)}" checked><span>${escapeHtml(intent.name)}</span></label>
  `).join("");
}

// Áudio (item 32): da empresa ou global, gerido aqui pelo Master. O arquivo
// só é escolhido na criação; depois, só nome/atalho/escopo/setor mudam.
function syncContentType(item = null) {
  const audio = $("#qr-content-type").value === "AUDIO";
  $("#qr-text-field").hidden = audio;
  $("#qr-text").required = !audio;
  $("#qr-audio-field").hidden = !audio;
  $("#qr-audio-file").hidden = Boolean(item);
  $("#qr-audio-file").required = audio && !item;
  $("#qr-audio-player").hidden = !item?.audio;
  if (item?.audio) $("#qr-audio-player").src = item.audio.url;
}

function fillForm(item = null) {
  $("#qr-content-type").value = item?.contentType || "TEXT";
  $("#qr-content-type").disabled = Boolean(item);
  $("#qr-audio-file").value = "";
  syncContentType(item);
  $("#qr-name").value = item?.name || "";
  $("#qr-shortcut").value = item?.shortcut || "";
  renderCompanyOptions(item);
  $("#qr-type").value = item?.type || "QUICK_REPLY";
  $("#qr-text").value = item?.text || "";
  $("#qr-available-agents").checked = item ? item.availableToAgents : true;
  $("#qr-available-bots").checked = item ? item.availableToBots : false;
  renderChannelsChecklist(item?.channels || []);
  renderIntentsChecklist(item);
  renderPreview();
  $("#qr-usage-count").textContent = item?.usageCount ?? 0;
  $("#qr-favorite-count").textContent = item?.favoriteCount ?? 0;
}

// Prévia com dados fictícios, preservando quebras de linha e a formatação do
// WhatsApp (*negrito*, _itálico_, ~tachado~).
const whatsappFormat = (text) => escapeHtml(text)
  .replace(/\*([^*\n]+)\*/g, "<strong>$1</strong>")
  .replace(/_([^_\n]+)_/g, "<em>$1</em>")
  .replace(/~([^~\n]+)~/g, "<s>$1</s>")
  .replace(/\n/g, "<br>");

async function renderPreview() {
  const text = $("#qr-text").value;
  const seq = ++state.previewSeq;
  if ($("#qr-content-type").value === "AUDIO") { $("#qr-preview").innerHTML = "<p>Respostas em áudio são enviadas como arquivo — use o player acima.</p>"; return; }
  if (!text.trim()) { $("#qr-preview").innerHTML = "<p>Digite o texto para ver o preview.</p>"; return; }
  try {
    const result = await api("/api/quick-replies/preview", { method: "POST", body: JSON.stringify({ text }) });
    if (seq !== state.previewSeq) return;
    $("#qr-preview").innerHTML = `<div class="qr-bubble">${whatsappFormat(result.text)}</div>${result.unresolved.length
      ? `<p class="qr-preview-warning">Variável sem valor de exemplo: ${result.unresolved.map((name) => `<code>${escapeHtml(name)}</code>`).join(", ")}. Na conversa real ela é preenchida se houver o dado; confira o nome da variável.</p>` : ""}`;
  } catch (error) {
    if (seq === state.previewSeq) $("#qr-preview").innerHTML = `<p class="qr-preview-warning">Prévia indisponível: ${escapeHtml(error.message)}</p>`;
  }
}

function renderEditor() {
  const item = state.selected;
  $("#empty-state").hidden = Boolean(item) || $("#editor").dataset.creating === "true";
  $("#editor").hidden = !item && $("#editor").dataset.creating !== "true";
  if (!item) return;
  $("#editor").dataset.creating = "false";
  $("#editor-eyebrow").textContent = "RESPOSTA SELECIONADA";
  $("#editor-title").textContent = item.name;
  $("#editor-description").textContent = `${item.shortcut} — criado por ${item.createdBy?.name || "—"}`;
  $("#status-actions").hidden = false;
  $("#status-badge").textContent = item.active ? "ATIVA" : "INATIVA";
  $("#status-badge").className = `status-badge ${item.active ? "ACTIVE" : "PAUSED"}`;
  $("#toggle-active").textContent = item.active ? "Desativar" : "Ativar";
  fillForm(item);
}

async function selectQuickReply(id) {
  const seq = ++state.selectSeq;
  // Destaque imediato: o clique é percebido mesmo antes da resposta.
  document.querySelectorAll("[data-qr-id]").forEach((card) => card.classList.toggle("active", card.dataset.qrId === id));
  $("#editor").setAttribute("aria-busy", "true");
  try {
    const item = await api(`/api/quick-replies/${encodeURIComponent(id)}`);
    if (seq !== state.selectSeq) return;
    state.selected = item;
    renderEditor();
    renderList();
  } catch (error) {
    if (seq === state.selectSeq) { toast(error.message, true); renderList(); }
  } finally {
    if (seq === state.selectSeq) $("#editor").removeAttribute("aria-busy");
  }
}

function startNew() {
  state.selectSeq++;
  state.selected = null;
  $("#editor").dataset.creating = "true";
  $("#empty-state").hidden = true;
  $("#editor").hidden = false;
  $("#editor-eyebrow").textContent = "NOVA RESPOSTA";
  $("#editor-title").textContent = "Criar resposta rápida";
  $("#editor-description").textContent = "Defina nome, atalho e texto — o atalho precisa começar com \"/\".";
  $("#status-actions").hidden = true;
  fillForm();
  renderList();
  $("#qr-name").focus();
}

function formPayload() {
  const intentInputs = document.querySelectorAll("#qr-intents-checklist input");
  return {
    name: $("#qr-name").value,
    shortcut: $("#qr-shortcut").value,
    categoryIds: Array.from(document.querySelectorAll("#qr-categories-checklist input:checked")).map((input) => input.value),
    scope: $("#qr-company").value === "GLOBAL" ? "GLOBAL" : "COMPANY",
    companyId: $("#qr-company").value === "GLOBAL" ? null : ($("#qr-company").value || undefined),
    type: $("#qr-type").value,
    text: $("#qr-text").value,
    channels: Array.from(document.querySelectorAll("#qr-channels-checklist input:checked")).map((input) => input.value),
    availableToAgents: $("#qr-available-agents").checked,
    availableToBots: $("#qr-available-bots").checked,
    ...(intentInputs.length ? { intentIds: Array.from(intentInputs).filter((input) => input.checked).map((input) => input.value) } : {}),
  };
}

$("#new-qr").addEventListener("click", startNew);
$("#empty-new-qr").addEventListener("click", startNew);
$("#qr-list").addEventListener("click", (event) => {
  const card = event.target.closest("[data-qr-id]");
  if (card) return selectQuickReply(card.dataset.qrId);
  if (event.target.closest("[data-qr-retry]")) return state.booted ? loadList() : boot();
  if (event.target.closest("[data-qr-clear-filters]")) {
    $("#qr-search").value = ""; $("#qr-filter-category").value = ""; $("#qr-filter-channel").value = ""; $("#qr-filter-active").value = "";
    loadList();
  }
});
$("#qr-search").addEventListener("input", () => { clearTimeout($("#qr-search")._t); $("#qr-search")._t = setTimeout(loadList, 250); });
$("#qr-filter-category").addEventListener("change", loadList);
$("#qr-filter-channel").addEventListener("change", loadList);
$("#qr-filter-active").addEventListener("change", loadList);
$("#qr-company").addEventListener("change", () => renderCategoriesChecklist());
$("#qr-text").addEventListener("input", () => { clearTimeout($("#qr-text")._t); $("#qr-text")._t = setTimeout(renderPreview, 250); });

$("#qr-content-type").addEventListener("change", () => { syncContentType(state.selected); renderPreview(); });

async function createManagedAudio(payload) {
  const file = $("#qr-audio-file").files[0];
  if (!file) throw new Error("Escolha o arquivo de áudio.");
  const form = new FormData();
  form.append("file", file);
  for (const key of ["name", "shortcut", "scope", "companyId", "categoryId"]) if (payload[key]) form.append(key, payload[key]);
  form.append("categoryIds", JSON.stringify(payload.categoryIds || []));
  const response = await fetch("/api/quick-replies/managed-audio", { method: "POST", body: form, credentials: "same-origin" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Não foi possível salvar o áudio.");
  return body;
}

$("#qr-form").addEventListener("submit", (event) => {
  event.preventDefault();
  withBusy(event.submitter || $("#qr-form [type=submit]"), "Salvando...", async () => {
    try {
      const payload = formPayload();
      const audio = $("#qr-content-type").value === "AUDIO";
      if (audio) delete payload.text;
      const editing = Boolean(state.selected);
      const saved = audio && !editing
        ? await createManagedAudio(payload)
        : editing
          ? await api(`/api/quick-replies/${state.selected.id}`, { method: "PATCH", body: JSON.stringify(payload) })
          : await api("/api/quick-replies", { method: "POST", body: JSON.stringify(payload) });
      toast(audio && !editing ? "Áudio rápido criado." : editing ? "Resposta atualizada." : "Resposta criada.");
      await loadList();
      await selectQuickReply(saved.id);
    } catch (error) { toast(error.message, true); }
  });
});

$("#toggle-active").addEventListener("click", (event) => {
  if (!state.selected) return;
  withBusy(event.currentTarget, "Salvando...", async () => {
    try {
      const updated = await api(`/api/quick-replies/${state.selected.id}`, { method: "PATCH", body: JSON.stringify({ active: !state.selected.active }) });
      toast(updated.active ? "Resposta ativada." : "Resposta desativada.");
      await loadList();
      await selectQuickReply(updated.id);
    } catch (error) { toast(error.message, true); }
  });
});

$("#archive-qr").addEventListener("click", (event) => {
  if (!state.selected || state.busy) return;
  if (!confirm(`Arquivar "${state.selected.name}"? Ela deixa de aparecer para atendentes, mas o histórico de uso é preservado.`)) return;
  withBusy(event.currentTarget, "Arquivando...", async () => {
    try {
      await api(`/api/quick-replies/${state.selected.id}`, { method: "DELETE" });
      toast("Resposta arquivada.");
      state.selected = null;
      $("#editor").dataset.creating = "false";
      $("#editor").hidden = true;
      $("#empty-state").hidden = false;
      await loadList();
    } catch (error) { toast(error.message, true); }
  });
});

$("#theme-toggle").addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme !== "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  try { localStorage.setItem("mibro-theme", dark ? "dark" : "light"); } catch { /* ignore */ }
  $("#theme-toggle").textContent = dark ? "☾" : "☀";
});
$("#logout").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" });
  location.replace("/login.html");
});

// Carga inicial automática. Cada dependência falha de forma visível: sem
// setores, a lista ainda carrega (só os filtros/checklists ficam vazios).
async function boot() {
  state.listStatus = "loading";
  renderList();
  let status;
  try { status = await api("/api/auth/status"); }
  catch (error) { state.listStatus = "error"; state.listError = error.message; renderList(); return; }
  if (!status.authenticated || !status.user.isMaster) return location.replace("/");
  $("#current-user").textContent = status.user.name;
  state.booted = true;
  const [categories] = await Promise.allSettled([api("/api/categories"), window.CompanyContext.load()]);
  if (categories.status === "fulfilled") state.categories = categories.value.filter((category) => category.active !== false);
  else toast(`Setores indisponíveis: ${categories.reason.message}`, true);
  state.companyFilter = "ALL";
  state.companyFilter = window.CompanyContext.mountFilter($("#qr-company-filter"), (slug) => { state.companyFilter = slug; loadList(); }, "ALL");
  renderFilterOptions();
  renderCompanyOptions();
  await loadList();
}
boot();
