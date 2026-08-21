const state = {
  conversations: [], categories: [], users: [], currentUser: null,
  selectedId: null, selectedContactId: null, selectedCategoryId: "", status: "", category: "", search: "",
  categorySignature: "", listSignature: "", selectedHeaderSignature: "",
  selectedMessagesSignature: "", selectedNotesSignature: "", selectedActivitiesSignature: "", selectedMessageItems: [],
  selectedMessages: [], selectedContactName: "", contactFilesTab: "media",
  expandedCategories: new Set(), adminUsers: [], auditLogs: [], editingUserId: null, assignedUser: "",
  assignedUserActiveOnly: false, alertCursor: null, checkingAlerts: false,
  customerServiceWindow: null, templates: [], selectedTemplate: null,
  metaStatus: { templatesConfigured:false }, outboundTemplate: null, categoryVisibility: { hideUncategorized:false, hiddenCategoryIds:[] }, visibilityMode:false,
};
const $ = (selector) => document.querySelector(selector);
const defaultDocumentTitle = document.title;
let waitingTitleTimer = null;
let waitingAlertCount = 0;
let conversationLoadSequence = 0;
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[char]);
const initials = (name = "?") => name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
const conversationTimeZone = "America/Sao_Paulo";
const time = (value) => value ? new Intl.DateTimeFormat("pt-BR", { hour:"2-digit", minute:"2-digit", timeZone:conversationTimeZone }).format(new Date(value)) : "";
const statusLabel = (value) => ({ NOVO:"Novo", EM_ATENDIMENTO:"Em atendimento", AGUARDANDO_RESPOSTA:"Aguardando resposta", BOT:"Bot", FINALIZADO:"Finalizado" })[value] || value;
const categoryLabel = (category) => category?.parent?.name ? `${category.parent.name}: ${category.name}` : (category?.name || "Sem categoria");
const documentTypeLabels = new Map([
  ["application/pdf", "PDF"], ["text/plain", "TXT"], ["application/msword", "DOC"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "DOCX"],
  ["application/vnd.ms-excel", "XLS"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "XLSX"],
  ["application/vnd.ms-powerpoint", "PPT"],
  ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "PPTX"],
]);
const isDocumentMime = (value) => documentTypeLabels.has(String(value || "").toLowerCase());
const documentTypeLabel = (mimeType, fileName = "") => documentTypeLabels.get(String(mimeType || "").toLowerCase())
  || fileName.split(".").pop()?.toUpperCase().slice(0, 5) || "DOC";
function orderedCategories(categories) {
  const roots = categories.filter((category) => !category.parentId);
  const nested = roots.flatMap((root) => [root, ...categories.filter((category) => category.parentId === root.id)]);
  const included = new Set(nested.map((category) => category.id));
  return [...nested, ...categories.filter((category) => !included.has(category.id))];
}
function populateSubcategorySelect(parentId, selectedId = "") {
  const select = $("#subcategory-select");
  const children = state.categories.filter((category) => category.active && category.parentId === parentId && category.selectable !== false);
  select.innerHTML = `<option value="">Subcategoria (opcional)</option>` + children.map((category) => `<option value="${category.id}">${escapeHtml(category.name)}</option>`).join("");
  select.hidden = !parentId || !children.length;
  if (children.some((category) => category.id === selectedId)) select.value = selectedId;
}
function pendingCategoryId() {
  return $("#subcategory-select").value || $("#category-select").value || "";
}
function syncCategoryConfirmation() {
  const primaryOption = $("#category-select").selectedOptions[0];
  const unavailableRoot = !$("#subcategory-select").value && primaryOption?.dataset.selectable === "false";
  $("#confirm-category").disabled = !state.selectedId || unavailableRoot
    || pendingCategoryId() === state.selectedCategoryId;
}
function closeConversationView() {
  conversationLoadSequence += 1;
  state.selectedId = null;
  state.selectedContactId = null;
  state.selectedCategoryId = "";
  state.selectedHeaderSignature = "";
  state.selectedMessagesSignature = "";
  state.selectedNotesSignature = "";
  state.selectedActivitiesSignature = "";
  state.selectedMessageItems = [];
  state.selectedMessages = [];
  state.selectedContactName = "";
  state.customerServiceWindow = null;
  syncCustomerServiceWindow();
  if ($("#contact-files-dialog")?.open) $("#contact-files-dialog").close();
  $("#notes-panel").classList.remove("open");
  $("#history-panel").classList.remove("open");
  $("#chat-content").hidden = true;
  $("#empty-state").hidden = false;
  $("#chat-panel").classList.remove("open");
  $("#confirm-category").disabled = true;
}
function syncWaitingAttention(count) {
  const waitingCount = Number(count) || 0;
  waitingAlertCount = waitingCount;
  if (waitingCount && !waitingTitleTimer) {
    let warningVisible = false;
    waitingTitleTimer = setInterval(() => {
      warningVisible = !warningVisible;
      document.title = warningVisible ? `⚠ ${waitingAlertCount} AGUARDANDO RESPOSTA` : defaultDocumentTitle;
    }, 900);
  }
  if (!waitingCount && waitingTitleTimer) {
    clearInterval(waitingTitleTimer);
    waitingTitleTimer = null;
    document.title = defaultDocumentTitle;
  }
}
function deliveryStatus(status) {
  return ({
    PENDENTE:["◷", "Pendente", "pending"], ENVIADA:["✓", "Enviada", "sent"],
    ENTREGUE:["✓✓", "Entregue", "delivered"], LIDA:["✓✓", "Lida", "read"],
    FALHOU:["!", "Falhou", "failed"],
  })[status] || ["", "", ""];
}
function syncThemeToggle() {
  const dark = document.documentElement.dataset.theme === "dark";
  $("#theme-icon").textContent = dark ? "☀" : "☾";
  $("#theme-toggle").setAttribute("aria-label", dark ? "Usar tema claro" : "Usar tema escuro");
  $("#theme-toggle").title = dark ? "Usar tema claro" : "Usar tema escuro";
}
const messagePreview = (message) => {
  if (!message) return "Conversa sem mensagens";
  if (message.type === "image") return message.text && message.text !== "[image]" ? `📷 ${message.text}` : "📷 Imagem";
  if (message.type === "audio") return "▶ Áudio";
  if (message.type === "video") return message.text && message.text !== "[video]" ? `🎬 ${message.text}` : "🎬 Vídeo";
  if (message.type === "sticker") return "💟 Figurinha";
  if (message.type === "document") return `📄 ${message.mediaFileName || "Documento"}`;
  return message.text || `[${message.type}]`;
};

function formatFileSize(value, typeLabel = "ARQUIVO") {
  const bytes = Number(value) || 0;
  if (!bytes) return typeLabel;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB • ${typeLabel}`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".0", "")} MB • ${typeLabel}`;
}

function conversationSignature(conversation) {
  const lastMessage = conversation.messages?.[0];
  const note = conversation.contact.notes?.[0];
  return JSON.stringify([
    conversation.id, conversation.id === state.selectedId, conversation.status, conversation.unreadCount, conversation.lastMessageAt,
    conversation.categoryId, conversation.category?.name, conversation.category?.color, conversation.category?.parent?.name,
    conversation.assignedUserId, conversation.assignedUser?.name,
    conversation.isPinned,
    conversation.contact.customName, conversation.contact.name, conversation.contact.phone, conversation.contact._count?.notes,
    note?.id, note?.content,
    lastMessage?.id, lastMessage?.text, lastMessage?.type,
  ]);
}

function conversationCardMarkup(c) {
  const last = c.messages[0]; const name = c.contact.customName || c.contact.name || c.contact.phone; const note = c.contact.notes?.[0];
  return `<button class="conversation-card ${c.id === state.selectedId ? "active" : ""}" data-id="${escapeHtml(c.id)}">
    <span class="card-grip" aria-hidden="true"></span><span class="avatar">${escapeHtml(initials(name))}</span><span class="card-main">
    <span class="card-title"><strong>${c.isPinned ? `<i class="conversation-pin" title="Conversa fixada">★</i>` : ""}${escapeHtml(name)}</strong><small>${escapeHtml(c.contact.phone)}</small></span>
    <span class="preview">${escapeHtml(messagePreview(last))}</span>
    <span class="card-labels"><span class="category-label" style="color:${c.category?.color || "#666"};border-color:${c.category?.color || "#aaa"}">${escapeHtml(categoryLabel(c.category))}</span><span class="status-label">${escapeHtml(statusLabel(c.status))}</span>${c.assignedUser ? `<span class="assignee-label">${escapeHtml(c.assignedUser.name)}</span>` : ""}</span>
    <span class="note-preview"><b>NOTA</b> ${escapeHtml(note?.content || "Sem notas para este contato")}${c.contact._count?.notes ? `<i>${c.contact._count.notes}</i>` : ""}</span></span>
    <span class="card-side"><span>${time(c.lastMessageAt)}</span>${c.unreadCount ? `<span class="unread">${c.unreadCount}</span>` : ""}</span></button>`;
}

function renderConversationCards(conversations) {
  const list = $("#conversation-list");
  if (!conversations.length) {
    if (!list.querySelector(".empty-list")) list.innerHTML = `<div class="empty-list">Nenhuma conversa encontrada.</div>`;
    return;
  }
  list.querySelector(".empty-list")?.remove();
  const existing = new Map([...list.querySelectorAll(".conversation-card")].map((card) => [card.dataset.id, card]));
  const expectedIds = new Set(conversations.map((conversation) => conversation.id));
  let position = list.firstElementChild;
  for (const conversation of conversations) {
    const signature = conversationSignature(conversation);
    let card = existing.get(conversation.id);
    if (!card || card.dataset.renderSignature !== signature) {
      const replacesCurrentPosition = card === position;
      const template = document.createElement("template");
      template.innerHTML = conversationCardMarkup(conversation);
      const replacement = template.content.firstElementChild;
      replacement.dataset.renderSignature = signature;
      if (card) card.replaceWith(replacement);
      card = replacement;
      if (replacesCurrentPosition) position = card;
    }
    if (card !== position) list.insertBefore(card, position);
    position = card.nextElementSibling;
  }
  existing.forEach((card, id) => { if (!expectedIds.has(id)) card.remove(); });
}

function messageContent(message) {
  const mediaUrl = `/api/messages/${encodeURIComponent(message.id)}/media`;
  if (message.type === "image" && message.mediaStorageKey) {
    return `<a class="message-image-link" href="${mediaUrl}" target="_blank" rel="noopener"><img class="message-image" src="${mediaUrl}" alt="${escapeHtml(message.text || "Imagem da conversa")}" loading="lazy"></a>${message.text && message.text !== "[image]" ? `<p>${escapeHtml(message.text)}</p>` : ""}`;
  }
  if (message.type === "audio" && message.mediaStorageKey) {
    return `<audio class="message-audio" controls preload="metadata"><source src="${mediaUrl}" type="${escapeHtml(message.mediaMimeType || "audio/ogg")}">Seu navegador não conseguiu reproduzir este áudio.</audio><a class="audio-download" href="${mediaUrl}" download>Baixar áudio</a>`;
  }
  if (message.type === "video" && message.mediaStorageKey) {
    return `<video class="message-video" controls preload="metadata" playsinline><source src="${mediaUrl}" type="${escapeHtml(message.mediaMimeType || "video/mp4")}">Seu navegador não conseguiu reproduzir este vídeo.</video>${message.text && message.text !== "[video]" ? `<p>${escapeHtml(message.text)}</p>` : ""}<a class="media-download" href="${mediaUrl}" download>Baixar vídeo</a>`;
  }
  if (message.type === "sticker" && message.mediaStorageKey) {
    return `<img class="message-sticker" src="${mediaUrl}" alt="Figurinha recebida" loading="lazy">`;
  }
  if (message.type === "document" && message.mediaStorageKey) {
    const fileName = message.mediaFileName || "documento";
    const typeLabel = documentTypeLabel(message.mediaMimeType, fileName);
    return `<a class="message-document" href="${mediaUrl}" target="_blank" rel="noopener"><span class="document-icon" aria-hidden="true">${escapeHtml(typeLabel)}</span><span class="document-details"><strong>${escapeHtml(fileName)}</strong><small>${escapeHtml(formatFileSize(message.mediaSize, typeLabel))}</small></span><span class="document-action">Abrir</span></a>${message.text && message.text !== "[document]" ? `<p>${escapeHtml(message.text)}</p>` : ""}`;
  }
  if (message.type === "image") return "<p>[Imagem indisponível]</p>";
  if (message.type === "audio") return "<p>[Áudio indisponível]</p>";
  if (message.type === "video") return "<p>[Vídeo indisponível]</p>";
  if (message.type === "sticker") return "<p>[Figurinha indisponível]</p>";
  if (message.type === "document") return "<p>[Documento indisponível]</p>";
  return `<p>${escapeHtml(message.text || `[${message.type}]`)}</p>`;
}

function messageRowMarkup(message) {
  const [symbol, label, statusClass] = deliveryStatus(message.status);
  return `<div class="message-row ${message.direction === "ENVIADA" ? "sent" : "received"}" data-message-id="${escapeHtml(message.id)}"><div class="bubble ${["image", "audio", "video", "sticker", "document"].includes(message.type) ? `${message.type}-bubble` : ""} ${message.reactionEmoji ? "has-reaction" : ""}">${messageContent(message)}<footer>${message.sentByUser ? `<span class="author">${escapeHtml(message.sentByUser.name)}</span>` : ""}<span>${time(message.occurredAt)}</span>${message.direction === "ENVIADA" ? `<span class="delivery-status ${statusClass}" title="${label}" aria-label="${label}">${symbol}</span>` : ""}</footer>${message.reactionEmoji ? `<span class="message-reaction" title="Reação do cliente">${escapeHtml(message.reactionEmoji)}</span>` : ""}</div></div>`;
}

function messageDateKey(value) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year:"numeric", month:"2-digit", day:"2-digit", timeZone:conversationTimeZone,
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map(({ type, value: partValue }) => [type, partValue]));
  return `${values.year}-${values.month}-${values.day}`;
}

function messageDateLabel(value, now = new Date()) {
  const key = messageDateKey(value);
  const todayKey = messageDateKey(now);
  const dayNumber = (dateKey) => {
    const [year, month, day] = dateKey.split("-").map(Number);
    return Date.UTC(year, month - 1, day) / 86400000;
  };
  const difference = dayNumber(todayKey) - dayNumber(key);
  if (difference === 0) return "Hoje";
  if (difference === 1) return "Ontem";
  return new Intl.DateTimeFormat("pt-BR", {
    day:"2-digit", month:"long", year:"numeric", timeZone:conversationTimeZone,
  }).format(new Date(value));
}

function messageRowsMarkup(messages, previousMessage = null) {
  let previousDateKey = previousMessage ? messageDateKey(previousMessage.occurredAt) : "";
  return messages.map((message) => {
    const currentDateKey = messageDateKey(message.occurredAt);
    const label = messageDateLabel(message.occurredAt);
    const separator = currentDateKey === previousDateKey ? ""
      : `<div class="message-date-separator" role="separator" aria-label="${escapeHtml(label)}"><span>${escapeHtml(label)}</span></div>`;
    previousDateKey = currentDateKey;
    return `${separator}${messageRowMarkup(message)}`;
  }).join("");
}

function messagesWithReactions(messages) {
  const reactions = new Map();
  for (const message of messages) {
    if (message.type !== "reaction") continue;
    const targetId = message.rawPayload?.reaction?.message_id;
    const emoji = message.rawPayload?.reaction?.emoji ?? message.text ?? "";
    if (!targetId) continue;
    if (emoji) reactions.set(targetId, emoji); else reactions.delete(targetId);
  }
  return messages
    .filter((message) => message.type !== "reaction")
    .map((message) => ({ ...message, reactionEmoji: reactions.get(message.externalId) || "" }));
}

function sharedFileMeta(message) {
  const author = message.direction === "ENVIADA" ? (message.sentByUser?.name || "Equipe") : "Cliente";
  const occurredAt = new Intl.DateTimeFormat("pt-BR", {
    dateStyle:"short", timeStyle:"short", timeZone:conversationTimeZone,
  }).format(new Date(message.occurredAt));
  return `${author} • ${occurredAt}`;
}

function externalLinks(messages) {
  const found = new Map();
  const pattern = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;
  for (const message of messages) {
    for (const match of String(message.text || "").match(pattern) || []) {
      const raw = match.replace(/[),.!?;:\]}]+$/g, "");
      const candidate = raw.toLowerCase().startsWith("www.") ? `https://${raw}` : raw;
      try {
        const parsed = new URL(candidate);
        if (!["http:", "https:"].includes(parsed.protocol)) continue;
        if (!found.has(parsed.href)) found.set(parsed.href, {
          href:parsed.href, label:raw, host:parsed.hostname.replace(/^www\./, ""), message,
        });
      } catch {}
    }
  }
  return [...found.values()];
}

function renderContactFiles(tab = "media") {
  state.contactFilesTab = tab;
  const messages = state.selectedMessages || [];
  const media = messages.filter((message) => ["image", "video"].includes(message.type) && message.mediaStorageKey);
  const documents = messages.filter((message) => message.type === "document" && message.mediaStorageKey);
  const links = externalLinks(messages);
  $("#media-files-count").textContent = media.length;
  $("#document-files-count").textContent = documents.length;
  $("#link-files-count").textContent = links.length;
  document.querySelectorAll("[data-files-tab]").forEach((button) => button.classList.toggle("active", button.dataset.filesTab === tab));

  let markup = "";
  if (tab === "media") {
    markup = media.length ? `<div class="shared-media-grid">${media.map((message) => {
      const url = `/api/messages/${encodeURIComponent(message.id)}/media`;
      const label = message.type === "video" ? "Vídeo" : "Imagem";
      const preview = message.type === "video"
        ? `<video controls preload="metadata" playsinline><source src="${url}" type="${escapeHtml(message.mediaMimeType || "video/mp4")}">Vídeo indisponível.</video>`
        : `<img src="${url}" alt="${escapeHtml(message.text || "Imagem da conversa")}" loading="lazy">`;
      const caption = message.text && !["[image]", "[video]"].includes(message.text) ? message.text : label;
      const wrapper = message.type === "image" ? "a" : "article";
      const linkAttributes = message.type === "image" ? ` href="${url}" target="_blank" rel="noopener"` : "";
      return `<${wrapper} class="shared-media-card"${linkAttributes}>${preview}<span class="shared-file-caption"><b>${escapeHtml(caption)}</b><small>${escapeHtml(sharedFileMeta(message))}</small></span></${wrapper}>`;
    }).join("")}</div>` : `<div class="shared-empty">Nenhuma imagem ou vídeo disponível nesta conversa.</div>`;
  } else if (tab === "documents") {
    markup = documents.length ? `<div class="shared-document-list">${documents.map((message) => {
      const url = `/api/messages/${encodeURIComponent(message.id)}/media`;
      const fileName = message.mediaFileName || "documento";
      const typeLabel = documentTypeLabel(message.mediaMimeType, fileName);
      return `<a class="shared-document-card" href="${url}" target="_blank" rel="noopener"><span class="shared-document-icon">${escapeHtml(typeLabel)}</span><span class="shared-file-details"><b>${escapeHtml(fileName)}</b><small>${escapeHtml(`${formatFileSize(message.mediaSize, typeLabel)} • ${sharedFileMeta(message)}`)}</small></span><span class="shared-open">Abrir</span></a>`;
    }).join("")}</div>` : `<div class="shared-empty">Nenhum documento disponível nesta conversa.</div>`;
  } else {
    markup = links.length ? `<div class="shared-link-list">${links.map((link) => `<a class="shared-link-card" href="${escapeHtml(link.href)}" target="_blank" rel="noopener noreferrer"><span class="shared-link-icon">↗</span><span class="shared-file-details"><b>${escapeHtml(link.label)}</b><small>${escapeHtml(`${link.host} • ${sharedFileMeta(link.message)}`)}</small></span><span class="shared-open">Abrir</span></a>`).join("")}</div>` : `<div class="shared-empty">Nenhum link encontrado nas mensagens desta conversa.</div>`;
  }
  $("#contact-files-content").innerHTML = markup;
}

function openContactFiles() {
  if (!state.selectedId) return;
  $("#contact-files-title").textContent = state.selectedContactName || "Arquivos da conversa";
  renderContactFiles("media");
  $("#contact-files-dialog").showModal();
}

function syncMessageStatuses(messages) {
  const rows = new Map([...$("#messages").querySelectorAll("[data-message-id]")].map((row) => [row.dataset.messageId, row]));
  for (const message of messages) {
    if (message.direction !== "ENVIADA") continue;
    const status = rows.get(message.id)?.querySelector(".delivery-status");
    if (!status) continue;
    const [symbol, label, statusClass] = deliveryStatus(message.status);
    status.textContent = symbol; status.title = label; status.setAttribute("aria-label", label);
    status.className = `delivery-status ${statusClass}`;
  }
}

async function loadCurrentUser() {
  const status = await api("/api/auth/status");
  if (!status.authenticated) return location.replace("/login.html");
  state.currentUser = status.user;
  $("#current-user").textContent = status.user.name;
  $("#team-button").hidden = !status.user.isMaster && !status.user.canViewTeamActivity;
  $("#open-audit").hidden = !status.user.isMaster;
  $("#manage-categories").hidden = !status.user.canManageCategories;
  $("#assignee-select").disabled = !status.user.canTransferConversations;
  $("#history-toggle").hidden = !status.user.canViewConversationHistory;
  configureNotificationButton();
  const cursorKey = `mibro-alert-cursor:${status.user.id}`;
  let storedCursor = null;
  try { storedCursor = localStorage.getItem(cursorKey); } catch {}
  state.alertCursor = storedCursor && !Number.isNaN(new Date(storedCursor).getTime()) ? storedCursor : new Date().toISOString();
  try { localStorage.setItem(cursorKey, state.alertCursor); } catch {}
}

async function loadUsers() {
  state.users = await api("/api/users");
  $("#assignee-select").innerHTML = `<option value="">Sem responsável</option>` + state.users.map((user) => `<option value="${user.id}">${escapeHtml(user.name)}</option>`).join("");
}

async function api(path, options) {
  const headers = new Headers(options?.headers || {});
  if (options?.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Não foi possível concluir a operação.");
    error.code = data.code;
    error.customerServiceWindow = data.customerServiceWindow;
    throw error;
  }
  return data;
}
function toast(message, error = false) { const el = $("#toast"); el.textContent = message; el.className = `toast show${error ? " error" : ""}`; setTimeout(() => el.className = "toast", 2600); }

function syncCustomerServiceWindow() {
  const configured = Boolean(state.customerServiceWindow?.configured);
  const closed = Boolean(state.selectedId && state.customerServiceWindow?.requiresTemplate);
  $("#open-templates").hidden = !configured;
  $("#service-window-notice").hidden = !closed;
  $("#composer").classList.toggle("window-closed", closed);
  $("#message-input").disabled = closed;
  $("#attachment-input").disabled = closed;
  $("#send-button").disabled = closed;
  $("#message-input").placeholder = closed ? "Use um template aprovado para retomar o contato" : "Digite uma mensagem...";
}

function templatePreview(template) {
  let preview = template.previewTemplate || template.preview || "";
  for (const variable of template.variables || []) {
    if (!["BODY", "HEADER"].includes(variable.component)) continue;
    const input = [...document.querySelectorAll("[data-template-variable]")].find((item) => item.dataset.templateVariable === variable.key);
    preview = preview.replaceAll(`{{${variable.placeholder}}}`, input?.value.trim() || variable.example || `{{${variable.placeholder}}}`);
  }
  return preview;
}

function renderTemplateEditor() {
  const template = state.selectedTemplate;
  $("#template-empty").hidden = Boolean(template);
  $("#template-editor").hidden = !template;
  if (!template) return;
  $("#template-selected-name").textContent = template.name;
  $("#template-selected-details").textContent = `${template.language} • ${template.category}`;
  $("#template-variables").innerHTML = (template.variables || []).map((variable) => `<label><span>${escapeHtml(variable.label)}</span><input data-template-variable="${escapeHtml(variable.key)}" value="${escapeHtml(variable.example || "")}" placeholder="Digite o valor" required></label>`).join("");
  $("#template-preview").textContent = templatePreview(template);
  document.querySelectorAll("[data-template-variable]").forEach((input) => input.addEventListener("input", () => {
    $("#template-preview").textContent = templatePreview(template);
  }));
}

function renderTemplateList() {
  const search = $("#template-search").value.trim().toLocaleLowerCase("pt-BR");
  const templates = state.templates.filter((template) => `${template.name} ${template.language} ${template.category}`.toLocaleLowerCase("pt-BR").includes(search));
  $("#template-list").innerHTML = templates.length ? templates.map((template) => `<button class="template-card ${state.selectedTemplate?.id === template.id ? "selected" : ""}" type="button" data-template-id="${escapeHtml(template.id)}" ${template.supported ? "" : "disabled"} title="${escapeHtml(template.unsupportedReason || "Selecionar template")}"><strong>${escapeHtml(template.name)}</strong><span><b>${escapeHtml(template.language)}</b><b>${escapeHtml(template.category)}</b></span><small>${escapeHtml(template.unsupportedReason || template.preview || "Sem prévia")}</small></button>`).join("") : `<div class="template-empty">Nenhum template aprovado encontrado.</div>`;
  document.querySelectorAll("[data-template-id]").forEach((button) => button.addEventListener("click", () => {
    state.selectedTemplate = state.templates.find((template) => template.id === button.dataset.templateId) || null;
    renderTemplateList();
    renderTemplateEditor();
  }));
}

async function openTemplates() {
  if (!state.selectedId) return;
  if (!state.customerServiceWindow?.configured) {
    toast("A integração de templates da Meta ainda não está ativada.", true);
    return;
  }
  state.selectedTemplate = null;
  $("#template-search").value = "";
  $("#template-list").innerHTML = `<div class="template-empty">Consultando templates aprovados na Meta...</div>`;
  renderTemplateEditor();
  $("#template-dialog").showModal();
  try {
    state.templates = await api("/api/meta/templates");
    renderTemplateList();
  } catch (error) {
    $("#template-list").innerHTML = `<div class="template-empty">${escapeHtml(error.message)}</div>`;
  }
}

function outboundTemplatePreview(template) {
  let preview = template.previewTemplate || template.preview || "";
  for (const variable of template.variables || []) {
    if (!["BODY", "HEADER"].includes(variable.component)) continue;
    const input = [...document.querySelectorAll("[data-outbound-template-variable]")]
      .find((item) => item.dataset.outboundTemplateVariable === variable.key);
    preview = preview.replaceAll(`{{${variable.placeholder}}}`, input?.value.trim() || variable.example || `{{${variable.placeholder}}}`);
  }
  return preview;
}

function renderOutboundTemplateEditor() {
  const template = state.outboundTemplate;
  $("#outbound-template-empty").hidden = Boolean(template);
  $("#outbound-template-content").hidden = !template;
  if (!template) return;
  $("#outbound-template-name").textContent = template.name;
  $("#outbound-template-details").textContent = `${template.language} • ${template.category}`;
  $("#outbound-template-variables").innerHTML = (template.variables || []).map((variable) => `<label><span>${escapeHtml(variable.label)}</span><input data-outbound-template-variable="${escapeHtml(variable.key)}" value="${escapeHtml(variable.example || "")}" placeholder="Digite o valor" required></label>`).join("");
  $("#outbound-template-preview").textContent = outboundTemplatePreview(template);
  document.querySelectorAll("[data-outbound-template-variable]").forEach((input) => input.addEventListener("input", () => {
    $("#outbound-template-preview").textContent = outboundTemplatePreview(template);
  }));
}

function renderOutboundTemplateList() {
  $("#outbound-template-list").innerHTML = state.templates.length ? state.templates.map((template) => `<button class="template-card ${state.outboundTemplate?.id === template.id ? "selected" : ""}" type="button" data-outbound-template-id="${escapeHtml(template.id)}" ${template.supported ? "" : "disabled"} title="${escapeHtml(template.unsupportedReason || "Selecionar template")}"><strong>${escapeHtml(template.name)}</strong><span><b>${escapeHtml(template.language)}</b><b>${escapeHtml(template.category)}</b></span><small>${escapeHtml(template.unsupportedReason || template.preview || "Sem prévia")}</small></button>`).join("") : `<div class="template-empty">Nenhum template aprovado encontrado.</div>`;
  document.querySelectorAll("[data-outbound-template-id]").forEach((button) => button.addEventListener("click", () => {
    state.outboundTemplate = state.templates.find((template) => template.id === button.dataset.outboundTemplateId) || null;
    renderOutboundTemplateList();
    renderOutboundTemplateEditor();
  }));
}

async function loadMetaStatus() {
  state.metaStatus = await api("/api/meta/status");
  const button = $("#new-conversation");
  button.dataset.unavailable = String(!state.metaStatus.templatesConfigured);
  button.title = state.metaStatus.templatesConfigured
    ? "Iniciar nova conversa pelo WhatsApp"
    : "Disponível após configurar os templates da Meta";
}

async function openOutboundConversation() {
  if (!state.metaStatus.templatesConfigured) return toast("A criação de conversas ficará disponível após configurar os templates da Meta.", true);
  state.outboundTemplate = null;
  $("#outbound-form").reset();
  $("#outbound-template-list").innerHTML = `<div class="template-empty">Consultando templates aprovados na Meta...</div>`;
  renderOutboundTemplateEditor();
  $("#outbound-dialog").showModal();
  try {
    state.templates = await api("/api/meta/templates");
    renderOutboundTemplateList();
  } catch (error) {
    $("#outbound-template-list").innerHTML = `<div class="template-empty">${escapeHtml(error.message)}</div>`;
  }
}

function configureNotificationButton() {
  const button = $("#enable-notifications");
  if (!("Notification" in window)) return;
  button.hidden = false;
  const granted = Notification.permission === "granted";
  button.textContent = granted ? "🔔 Alertas ativos" : "🔔 Ativar alertas";
  button.dataset.enabled = String(granted);
}

async function checkAlerts() {
  if (!state.currentUser || !state.alertCursor || state.checkingAlerts) return;
  state.checkingAlerts = true;
  try {
    const result = await api(`/api/alerts?since=${encodeURIComponent(state.alertCursor)}`);
    state.alertCursor = result.checkedAt;
    try { localStorage.setItem(`mibro-alert-cursor:${state.currentUser.id}`, state.alertCursor); } catch {}
    if (!result.alerts?.length) return;
    const latest = result.alerts[result.alerts.length - 1];
    toast(
  result.alerts.length === 1
    ? latest.title
    : `${result.alerts.length} novas mensagens.`
);
    if (document.hidden && typeof window.mibroNotify === "function") {
      for (const alert of result.alerts.slice(-3)) {
        await window.mibroNotify(alert.title, {
  tag: alert.id,
  data: {
    url: `/?conversation=${encodeURIComponent(alert.conversationId)}`
  },
});
      }
    }
  } catch (error) {
    console.warn("Não foi possível consultar os alertas.", error);
  } finally { state.checkingAlerts = false; }
}

async function setCategoryHidden(categoryId, hidden) {
  state.categoryVisibility = await api("/api/category-visibility", { method:"PATCH", body:JSON.stringify({ categoryId, hidden }) });
  state.categorySignature = "";
  await loadCategories();
  toast(hidden ? "Categoria ocultada para sua conta." : "Categoria exibida novamente.");
}

async function loadCategories() {
  const previousPrimaryCategory = $("#category-select").value;
  const previousSubcategory = $("#subcategory-select").value;
  const [categories, visibility] = await Promise.all([api("/api/categories"), api("/api/category-visibility")]);
  state.categories = categories;
  state.categoryVisibility = visibility;
  const signature = JSON.stringify([state.visibilityMode, visibility, categories.map((category) => [category.id, category.parentId, category.parent?.name, category.code, category.name, category.color, category.active, category.displayOrder, category.hidden])]);
  if (signature === state.categorySignature) return;
  state.categorySignature = signature;
  state.selectedHeaderSignature = "";
  const activeIds = new Set(categories.filter((category) => category.active).map((category) => category.id));
  const allActive = orderedCategories(categories.filter((category) => category.active && (!category.parentId || activeIds.has(category.parentId))));
  const shown = state.visibilityMode ? allActive : allActive.filter((category) => !category.hidden);
  if (state.category === "UNCATEGORIZED" && visibility.hideUncategorized && !state.visibilityMode) state.category = "";
  if (state.category && state.category !== "UNCATEGORIZED" && !shown.some((category) => category.code === state.category)) state.category = "";
  const roots = allActive.filter((category) => !category.parentId);
  const displayRoots = roots.filter((root) => state.visibilityMode
    || !root.hidden
    || shown.some((category) => category.parentId === root.id));
  const uncategorized = state.currentUser?.canViewUncategorized
    ? `<div class="category-filter-item ${visibility.hideUncategorized ? "category-hidden" : ""}" ${visibility.hideUncategorized && !state.visibilityMode ? "hidden" : ""}><button class="filter" data-category="UNCATEGORIZED"><span><i class="category-dot uncategorized-dot"></i>Sem categoria</span><strong data-uncategorized-count>0</strong></button><button class="category-eye" data-hide-category="UNCATEGORIZED" data-hidden="${visibility.hideUncategorized}" title="${visibility.hideUncategorized ? "Exibir" : "Ocultar"}">${visibility.hideUncategorized ? "◉" : "⊘"}</button></div>`
    : "";
  $("#category-filters").innerHTML = uncategorized + displayRoots.map((root) => {
    const children = shown.filter((category) => category.parentId === root.id);
    const rootShown = state.visibilityMode || !root.hidden;
    const expanded = !rootShown || state.expandedCategories.has(root.id);
    const row = (category, child = false) => `<div class="category-filter-item ${category.hidden ? "category-hidden" : ""}"><button class="filter ${child ? "subcategory-filter" : "category-parent-filter"}" data-category="${category.code}" ${!child ? `data-category-group="${category.id}" aria-expanded="${expanded}"` : ""}><span><i class="category-dot" style="background:${category.color || root.color || "#999"}"></i>${child ? "↳ " : ""}${escapeHtml(category.name)}${!child && children.length ? `<i class="category-chevron">${expanded ? "⌃" : "⌄"}</i>` : ""}</span><strong data-category-count="${category.id}">0</strong></button><button class="category-eye" data-hide-category="${category.id}" data-hidden="${category.hidden}" title="${category.hidden ? "Exibir" : "Ocultar"}">${category.hidden ? "◉" : "⊘"}</button></div>`;
    const rootRow = rootShown ? row(root) : `<div class="category-group-label"><i class="category-dot" style="background:${root.color || "#999"}"></i><span>${escapeHtml(root.name)}</span><small>principal oculta</small></div>`;
    return `<div class="category-filter-group">${rootRow}${children.length ? `<div class="subcategory-filters" data-category-children="${root.id}" ${expanded ? "" : "hidden"}>${children.map((child) => row(child, true)).join("")}</div>` : ""}</div>`;
  }).join("");
  $("#category-select").innerHTML = `${state.currentUser?.canViewUncategorized ? `<option value="">Sem categoria</option>` : `<option value="" disabled>Selecione a categoria</option>`}` + roots.map((category) => `<option value="${category.id}" data-selectable="${category.selectable !== false}">${escapeHtml(category.name)}</option>`).join("");
  $("#category-parent").innerHTML = `<option value="">Categoria principal</option>` + roots.map((category) => `<option value="${category.id}">${escapeHtml(category.name)}</option>`).join("");
  if ([...$("#category-select").options].some((option) => option.value === previousPrimaryCategory)) $("#category-select").value = previousPrimaryCategory;
  populateSubcategorySelect($("#category-select").value, previousSubcategory);
  document.querySelectorAll("[data-hide-category]").forEach((button) => button.addEventListener("click", () => setCategoryHidden(button.dataset.hideCategory, button.dataset.hidden !== "true").catch((error) => toast(error.message, true))));
  document.querySelectorAll("[data-category]").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.categoryGroup) {
      const groupId = button.dataset.categoryGroup; const children = document.querySelector(`[data-category-children="${groupId}"]`);
      if (children) { children.hidden = !children.hidden; button.setAttribute("aria-expanded", String(!children.hidden)); button.querySelector(".category-chevron").textContent = children.hidden ? "⌄" : "⌃"; if (children.hidden) state.expandedCategories.delete(groupId); else state.expandedCategories.add(groupId); }
    }
    document.querySelectorAll(".filter").forEach((item) => item.classList.remove("active")); button.classList.add("active"); state.category = button.dataset.category; state.status = ""; loadConversations();
  }));
  document.querySelectorAll(".filter").forEach((item) => item.classList.remove("active"));
  const selectedFilter = state.category ? [...document.querySelectorAll("[data-category]")].find((item) => item.dataset.category === state.category) : [...document.querySelectorAll("[data-status]")].find((item) => item.dataset.status === state.status);
  selectedFilter?.classList.add("active");
  renderCategoryManager();
}

function renderCategoryManager() {
  const ordered = orderedCategories(state.categories);
  $("#category-manager-list").innerHTML = ordered.map((category) => {
    const parents = state.categories.filter((candidate) => candidate.active && !candidate.parentId && candidate.id !== category.id);
    return `<form class="category-manager-row ${category.parentId ? "subcategory-row" : ""}" data-category-id="${category.id}">
    <input class="managed-color" type="color" value="${category.color || "#6b7280"}" aria-label="Cor de ${escapeHtml(category.name)}">
    <input class="managed-name" maxlength="60" value="${escapeHtml(category.name)}" aria-label="Nome da categoria" required>
    <select class="managed-parent" aria-label="Categoria principal"><option value="">Principal</option>${parents.map((parent) => `<option value="${parent.id}" ${parent.id === category.parentId ? "selected" : ""}>${escapeHtml(parent.name)}</option>`).join("")}</select>
    <label class="active-switch"><input class="managed-active" type="checkbox" ${category.active ? "checked" : ""}><span>${category.active ? "Ativa" : "Inativa"}</span></label>
    <button type="submit">Salvar</button>
  </form>`;
  }).join("");
}

async function loadConversations() {
  const params = new URLSearchParams();
  if (state.search) params.set("search", state.search);
  if (state.status) params.set("status", state.status);
  if (state.category) params.set("category", state.category);
  if (state.assignedUser) params.set("assignedUser", state.assignedUser);
  if (state.assignedUserActiveOnly) params.set("activeOnly", "true");
  const [conversations, summary] = await Promise.all([
    api(`/api/conversations?${params}`),
    api("/api/conversations/summary"),
  ]);
  state.conversations = conversations;
  const filteredUser = state.adminUsers.find((user) => user.id === state.assignedUser);
  $("#list-summary").textContent = `${state.conversations.length} atendimento${state.conversations.length === 1 ? "" : "s"}${filteredUser ? ` ativo${state.conversations.length === 1 ? "" : "s"} • ${filteredUser.name}` : ""}`;
  $("#clear-team-filter").hidden = !state.assignedUser;
  $("#count-all").textContent = summary.total || 0;
  $("#count-new").textContent = summary.statuses.NOVO || 0;
  $("#count-in-progress").textContent = summary.statuses.EM_ATENDIMENTO || 0;
  $("#count-waiting").textContent = summary.statuses.AGUARDANDO_RESPOSTA || 0;
  document.querySelector('[data-status="AGUARDANDO_RESPOSTA"]').classList.toggle("attention", Boolean(summary.attentionWaiting));
  syncWaitingAttention(summary.attentionWaiting);
  $("#count-bot").textContent = summary.statuses.BOT || 0;
  $("#count-finalized").textContent = summary.statuses.FINALIZADO || 0;
  document.querySelectorAll("[data-category-count]").forEach((counter) => {
    const categoryId = counter.dataset.categoryCount;
    const category = state.categories.find((item) => item.id === categoryId);
    const childIds = category?.parentId ? [] : state.categories.filter((item) => item.parentId === categoryId).map((item) => item.id);
    counter.textContent = [categoryId, ...childIds].reduce((total, id) => total + (summary.categories[id] || 0), 0);
  });
  document.querySelector("[data-uncategorized-count]")?.replaceChildren(String(summary.categories.null || 0));
  const signature = JSON.stringify({
    selectedId: state.selectedId,
    conversations: state.conversations.map(conversationSignature),
  });
  if (signature === state.listSignature) return;
  state.listSignature = signature;
  renderConversationCards(state.conversations);
}

async function openConversation(id, { refreshList = true, markRead = true } = {}) {
  const loadSequence = ++conversationLoadSequence;
  const changedConversation = state.selectedId !== id;
  state.selectedId = id;
  if (changedConversation) {
    state.selectedHeaderSignature = "";
    state.selectedMessagesSignature = "";
    state.selectedNotesSignature = "";
    state.selectedActivitiesSignature = "";
    state.selectedMessageItems = [];
    state.selectedMessages = [];
  }
  if (markRead) await api(`/api/conversations/${id}/read`, { method:"POST" });
  const c = await api(`/api/conversations/${id}`);
  if (loadSequence !== conversationLoadSequence || state.selectedId !== id) return;
  const headerSignature = JSON.stringify({
    id: c.id,
    status: c.status,
    categoryId: c.categoryId,
    category: c.category && [c.category.id, c.category.name, c.category.color, c.category.active, c.category.parentId, c.category.parent?.name],
    assignedUserId: c.assignedUserId,
    assignedUser: c.assignedUser && [c.assignedUser.id, c.assignedUser.name],
    isPinned: c.isPinned,
    canViewHistory: c.canViewHistory,
    contact: [c.contact.id, c.contact.customName, c.contact.name, c.contact.phone],
    messageHistoryLimited: c.messageHistoryLimited,
    customerServiceWindow: c.customerServiceWindow,
  });
  const displayMessages = messagesWithReactions(c.messages);
  state.selectedMessages = displayMessages;
  state.selectedContactName = c.contact.customName || c.contact.name || c.contact.phone;
  const hasReactionEvents = displayMessages.length !== c.messages.length;
  const messageItems = displayMessages.map((message) => JSON.stringify([message.id, message.externalId, message.direction, message.type, message.text, message.occurredAt, message.mediaStorageKey, message.mediaMimeType, message.mediaFileName, message.mediaSize, message.reactionEmoji, message.sentByUser?.id, message.sentByUser?.name]));
  const messagesSignature = JSON.stringify([c.messageHistoryLimited, messageItems]);
  const notesSignature = JSON.stringify((c.contact.notes || []).map((note) => [note.id, note.content, note.pinned, note.createdAt, note.updatedAt, note.author?.name]));
  const activitiesSignature = JSON.stringify((c.activities || []).map((activity) => [activity.id, activity.action, activity.details, activity.createdAt, activity.actorUser?.name]));
  state.selectedContactId = c.contact.id;
  state.customerServiceWindow = c.customerServiceWindow;
  syncCustomerServiceWindow();
  $("#empty-state").hidden = true; $("#chat-content").hidden = false; $("#chat-panel").classList.add("open");
  if (headerSignature !== state.selectedHeaderSignature) {
    state.selectedHeaderSignature = headerSignature;
    const name = c.contact.customName || c.contact.name || c.contact.phone;
    $("#contact-avatar").textContent = initials(name); $("#contact-name").textContent = name; $("#contact-phone").textContent = `+${c.contact.phone}`;
    const primaryCategory = c.category?.parent || (c.category && !c.category.parentId ? c.category : null);
    const primaryId = primaryCategory?.id || "";
    if (primaryId && ![...$("#category-select").options].some((option) => option.value === primaryId)) {
      $("#category-select").add(new Option(`${primaryCategory.name || "Categoria"} (inativa)`, primaryId, false, false));
    }
    $("#category-select").value = primaryId;
    const selectedSubcategory = c.category?.parentId ? c.categoryId : "";
    populateSubcategorySelect(primaryId, selectedSubcategory);
    if (selectedSubcategory && ![...$("#subcategory-select").options].some((option) => option.value === selectedSubcategory)) {
      $("#subcategory-select").add(new Option(`${c.category.name} (inativa)`, selectedSubcategory, false, true));
      $("#subcategory-select").hidden = false;
    }
    state.selectedCategoryId = c.categoryId || "";
    syncCategoryConfirmation();
    $("#status-badge").className = "status-badge"; $("#status-badge").textContent = statusLabel(c.status);
    if (c.assignedUserId && ![...$("#assignee-select").options].some((option) => option.value === c.assignedUserId)) {
      $("#assignee-select").add(new Option(c.assignedUser?.name || "Outro atendente", c.assignedUserId));
    }
    $("#assignee-select").value = c.assignedUserId || "";
    $("#claim-conversation").hidden = c.assignedUserId === state.currentUser?.id;
    $("#toggle-finalized").textContent = c.status === "FINALIZADO" ? "Reabrir" : "Finalizar"; $("#toggle-finalized").dataset.status = c.status;
    $("#delete-conversation").hidden = !state.currentUser?.isMaster;
    $("#pin-conversation").textContent = c.isPinned ? "★ Fixada" : "☆ Fixar";
    $("#pin-conversation").dataset.pinned = String(Boolean(c.isPinned));
    $("#history-toggle").hidden = !c.canViewHistory;
    if (!c.canViewHistory) $("#history-panel").classList.remove("open");
  }
  if (messagesSignature !== state.selectedMessagesSignature) {
    state.selectedMessagesSignature = messagesSignature;
    const canAppend = !hasReactionEvents && !changedConversation && state.selectedMessageItems.length <= messageItems.length
      && state.selectedMessageItems.every((item, index) => item === messageItems[index]);
    if (canAppend) {
      const previousMessage = state.selectedMessageItems.length ? displayMessages[state.selectedMessageItems.length - 1] : null;
      $("#messages").insertAdjacentHTML("beforeend", messageRowsMarkup(displayMessages.slice(state.selectedMessageItems.length), previousMessage));
    } else {
      $("#messages").innerHTML = `${c.messageHistoryLimited ? `<div class="limited-history-notice">As mensagens anteriores ao encaminhamento estão ocultas para esta conta.</div>` : ""}${messageRowsMarkup(displayMessages)}`;
    }
    state.selectedMessageItems = messageItems;
    $("#messages").scrollTop = $("#messages").scrollHeight;
  }
  syncMessageStatuses(displayMessages);
  if ($("#contact-files-dialog").open) renderContactFiles(state.contactFilesTab);
  if (notesSignature !== state.selectedNotesSignature) {
    state.selectedNotesSignature = notesSignature;
    renderNotes(c.contact.notes || []);
  }
  if (activitiesSignature !== state.selectedActivitiesSignature) {
    state.selectedActivitiesSignature = activitiesSignature;
    renderActivities(c.activities || []);
  }
  if (refreshList) await loadConversations();
}

let realtimeRefreshTimer;
let realtimeRefreshRunning = false;
async function refreshInbox() {
  if (realtimeRefreshRunning) return;
  realtimeRefreshRunning = true;
  try {
    await loadCategories();
    if (state.selectedId) await openConversation(state.selectedId, { refreshList:false, markRead:!document.hidden });
    await loadConversations();
    await checkAlerts();
  } finally {
    realtimeRefreshRunning = false;
  }
}

function connectRealtime() {
  const events = new EventSource("/api/events");
  events.addEventListener("inbox.updated", () => {
    clearTimeout(realtimeRefreshTimer);
    realtimeRefreshTimer = setTimeout(() => refreshInbox().catch(() => {}), 120);
  });
  window.addEventListener("beforeunload", () => events.close(), { once:true });
}

function renderNotes(notes) {
  $("#notes-list").innerHTML = notes.length ? notes.map((note) => `<article class="note ${note.pinned ? "pinned" : ""}"><div class="note-heading">${note.pinned ? `<span class="pinned-label">📌 FIXADA</span>` : `<span></span>`}<span class="note-actions"><button class="pin-note" type="button" data-note-id="${escapeHtml(note.id)}" data-pinned="${note.pinned}" title="${note.pinned ? "Desafixar nota" : "Fixar esta nota no topo"}">${note.pinned ? "Desafixar" : "📌 Fixar"}</button>${state.currentUser?.isMaster ? `<button class="delete-note" type="button" data-note-id="${escapeHtml(note.id)}" title="Apagar nota">Apagar</button>` : ""}</span></div><p>${escapeHtml(note.content)}</p><footer>${escapeHtml(note.author?.name || "Equipe")} • ${new Intl.DateTimeFormat("pt-BR", { dateStyle:"short", timeStyle:"short" }).format(new Date(note.createdAt))}</footer></article>`).join("") : `<div class="notes-empty">Nenhuma nota adicionada.</div>`;
}

function activityText(activity) {
  const details = activity.details || {};
  const status = (value) => statusLabel(value || "");
  return ({
    CONVERSATION_CREATED: "iniciou esta conversa pelo painel",
    CONVERSATION_CLAIMED: "assumiu a conversa como responsável",
    CONVERSATION_TRANSFERRED: `transferiu a conversa de ${details.from || "Sem responsável"} para ${details.to || "Sem responsável"}`,
    ASSIGNEE_REMOVED: `removeu ${details.from || "o atendente"} da responsabilidade pela conversa`,
    CATEGORY_CHANGED: `alterou a categoria de ${details.from || "Sem categoria"} para ${details.to || "Sem categoria"}`,
    STATUS_CHANGED: `alterou o status de ${status(details.from)} para ${status(details.to)}`,
    NOTE_ADDED: `adicionou uma nota${details.preview ? `: “${details.preview}”` : ""}`,
    NOTE_DELETED: `apagou uma nota${details.preview ? `: “${details.preview}”` : ""}`,
    NOTE_PINNED: `fixou uma nota${details.preview ? `: “${details.preview}”` : ""}`,
    NOTE_UNPINNED: `desafixou uma nota${details.preview ? `: “${details.preview}”` : ""}`,
    BOT_TRIAGE_COMPLETED: `Bot encaminhou a conversa para ${details.categoryName || "o setor selecionado"}`,
    AUTO_FINALIZED_INACTIVITY: `Sistema finalizou a conversa após ${details.inactivityMinutes || 1440} minutos sem resposta do cliente`,
  })[activity.action] || "realizou uma atualização na conversa";
}

function renderActivities(activities) {
  $("#history-list").innerHTML = activities.length ? activities.map((activity) => `<article class="history-item"><span class="history-dot" aria-hidden="true"></span><div><p><b>${escapeHtml(activity.actorUser?.name || "Sistema")}</b> ${escapeHtml(activityText(activity))}</p><time>${new Intl.DateTimeFormat("pt-BR", { dateStyle:"short", timeStyle:"short" }).format(new Date(activity.createdAt))}</time></div></article>`).join("") : `<div class="notes-empty">Nenhuma ação registrada ainda.</div>`;
}

const roleLabel = (role) => ({ ADMIN:"Master", SUPERVISOR:"Supervisor", ATENDENTE:"Atendente" })[role] || role;

function renderTeamCategoryAccess(selectedIds = [], canViewUncategorized = false) {
  const selected = new Set(selectedIds);
  const active = state.categories.filter((category) => category.active);
  const roots = active.filter((category) => !category.parentId);
  $("#team-category-access").innerHTML = `<div class="team-category-groups">
    <section class="team-category-group uncategorized">
      <label class="team-category-option root"><input id="permission-uncategorized" type="checkbox" ${canViewUncategorized ? "checked" : ""}><i class="category-dot uncategorized-dot"></i><span><b>Sem categoria</b><small>Conversas que ainda não foram classificadas.</small></span></label>
    </section>
    ${roots.map((root) => {
    const children = active.filter((category) => category.parentId === root.id);
    const rootSelected = selected.has(root.id);
    return `<section class="team-category-group" data-category-group="${escapeHtml(root.id)}">
      <label class="team-category-option root"><input class="team-category-root team-category-access-input" type="checkbox" value="${escapeHtml(root.id)}" ${rootSelected ? "checked" : ""}><i class="category-dot" style="background:${root.color || "#999"}"></i><span><b>${escapeHtml(root.name)}</b><small>${children.length ? `${children.length} subcategoria${children.length === 1 ? "" : "s"}` : "Categoria principal"}</small></span></label>
      ${children.length ? `<div class="team-subcategory-list">${children.map((child) => `<label class="team-category-option child"><input class="team-category-access-input" type="checkbox" value="${escapeHtml(child.id)}" ${selected.has(child.id) ? "checked" : ""}><i class="category-dot" style="background:${child.color || root.color || "#999"}"></i><span>${escapeHtml(child.name)}</span></label>`).join("")}</div>` : ""}
    </section>`;
  }).join("")}</div>`;
}

function syncMasterForm() {
  const master = $("#team-role").value === "ADMIN";
  document.querySelectorAll(".team-permissions input,.team-categories input").forEach((input) => { input.disabled = master; });
}

function resetTeamForm() {
  state.editingUserId = null;
  $("#team-form").reset();
  $("#team-role").value = "ATENDENTE";
  $("#team-active").checked = true;
  $("#team-active-field").hidden = true;
  $("#team-password").required = true;
  $("#team-password-label").textContent = "Senha inicial";
  $("#team-form-eyebrow").textContent = "NOVA CONTA";
  $("#team-form-title").textContent = "Adicionar membro";
  renderTeamCategoryAccess();
  syncMasterForm();
}

function editTeamUser(userId) {
  const user = state.adminUsers.find((item) => item.id === userId);
  if (!user) return;
  state.editingUserId = user.id;
  $("#team-name").value = user.name;
  $("#team-email").value = user.email;
  $("#team-role").value = user.role;
  $("#team-password").value = "";
  $("#team-password").required = false;
  $("#team-password-label").textContent = "Nova senha (opcional)";
  $("#team-active").checked = user.active;
  $("#team-active-field").hidden = false;
  $("#permission-categories").checked = user.canManageCategories;
  $("#permission-transfer").checked = user.canTransferConversations;
  $("#permission-team").checked = user.canViewTeamActivity;
  $("#permission-history").checked = user.canViewConversationHistory;
  $("#permission-previous-messages").checked = user.canViewPreviousMessages;
  $("#team-form-eyebrow").textContent = "EDITAR CONTA";
  $("#team-form-title").textContent = user.name;
  renderTeamCategoryAccess(user.categoryAccess.map((access) => access.categoryId), user.canViewUncategorized);
  syncMasterForm();
}

function renderAdminUsers() {
  $("#team-count").textContent = `${state.adminUsers.length} conta${state.adminUsers.length === 1 ? "" : "s"}`;
  $("#team-user-list").innerHTML = state.adminUsers.map((user) => `<article class="team-user-card ${user.active ? "" : "inactive"}"><div class="team-user-main"><span class="team-user-avatar">${escapeHtml(initials(user.name))}</span><span class="team-user-info"><b>${escapeHtml(user.name)}</b><small>${escapeHtml(user.email || "Membro da equipe")}</small></span><span class="role-pill">${escapeHtml(roleLabel(user.role))}</span></div><div class="team-user-meta"><span>${user._count.assignedConversations} conversa(s) atribuída(s)</span>${state.currentUser?.isMaster ? `<span>•</span><span>${user._count.sentMessages} resposta(s)</span>` : ""}${user.active ? "" : "<span>• Inativa</span>"}</div><div class="team-user-actions">${state.currentUser?.isMaster ? `<button type="button" data-edit-user="${escapeHtml(user.id)}">Editar</button>` : ""}<button type="button" data-view-user="${escapeHtml(user.id)}">Ver atendimentos</button></div></article>`).join("");
}

const auditActionLabel = (action) => ({
  USER_CREATED:"Conta criada", USER_UPDATED:"Conta alterada",
  CONVERSATION_DELETED:"Conversa apagada", CONVERSATION_PINNED:"Conversa fixada",
  CONVERSATION_UNPINNED:"Conversa desafixada", CONVERSATION_CATEGORY_CHANGED:"Categoria da conversa",
  CONVERSATION_ASSIGNEE_CHANGED:"Responsável da conversa", CONVERSATION_STATUS_CHANGED:"Status da conversa",
  CATEGORY_CREATED:"Categoria criada", CATEGORY_UPDATED:"Categoria alterada", NOTE_DELETED:"Nota apagada",
})[action] || action;

function renderAuditLogs() {
  $("#audit-count").textContent = `${state.auditLogs.length} registro${state.auditLogs.length === 1 ? "" : "s"}`;
  $("#audit-list").innerHTML = state.auditLogs.length ? state.auditLogs.map((log) => {
    const critical = ["CONVERSATION_DELETED", "USER_CREATED", "USER_UPDATED"].includes(log.action);
    const actor = log.actorName || log.actorEmail || "Sistema";
    const when = new Intl.DateTimeFormat("pt-BR", { dateStyle:"short", timeStyle:"medium" }).format(new Date(log.createdAt));
    const details = log.details ? escapeHtml(JSON.stringify(log.details, null, 2)) : "";
    return `<article class="audit-item ${critical ? "critical" : ""}"><span class="audit-marker" aria-hidden="true"></span><div class="audit-main"><header><b>${escapeHtml(auditActionLabel(log.action))}</b><time>${escapeHtml(when)}</time></header><p>${escapeHtml(log.summary)}</p><footer>Por <strong>${escapeHtml(actor)}</strong>${log.actorEmail ? ` • ${escapeHtml(log.actorEmail)}` : ""}</footer>${details ? `<details><summary>Ver detalhes técnicos</summary><pre>${details}</pre></details>` : ""}</div></article>`;
  }).join("") : `<div class="notes-empty">Nenhum registro encontrado para este filtro.</div>`;
}

async function loadAuditLogs() {
  if (!state.currentUser?.isMaster) return;
  const params = new URLSearchParams({ limit:"200" });
  const entityType = $("#audit-entity").value;
  const search = $("#audit-search").value.trim();
  if (entityType) params.set("entityType", entityType);
  if (search) params.set("search", search);
  state.auditLogs = await api(`/api/admin/audit-logs?${params}`);
  renderAuditLogs();
}

async function loadAdminUsers() {
  if (!state.currentUser?.isMaster && !state.currentUser?.canViewTeamActivity) return;
  state.adminUsers = await api(state.currentUser.isMaster ? "/api/admin/users" : "/api/team/users");
  renderAdminUsers();
}

$("#conversation-list").addEventListener("click", (event) => {
  const card = event.target.closest(".conversation-card");
  if (card) openConversation(card.dataset.id);
});
document.querySelectorAll("[data-status]").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".filter").forEach((item) => item.classList.remove("active")); button.classList.add("active"); state.status = button.dataset.status; state.category = ""; loadConversations();
}));
let searchTimer; $("#search").addEventListener("input", (event) => { clearTimeout(searchTimer); state.search = event.target.value.trim(); searchTimer = setTimeout(loadConversations, 250); });
$("#refresh").addEventListener("click", loadConversations);
$("#new-conversation").addEventListener("click", openOutboundConversation);
$("#close-outbound").addEventListener("click", () => $("#outbound-dialog").close());
$("#outbound-dialog").addEventListener("click", (event) => { if (event.target === $("#outbound-dialog")) $("#outbound-dialog").close(); });
$("#outbound-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.outboundTemplate) return toast("Selecione o template inicial.", true);
  const button = $("#send-outbound");
  const values = Object.fromEntries([...document.querySelectorAll("[data-outbound-template-variable]")].map((input) => [input.dataset.outboundTemplateVariable, input.value.trim()]));
  button.disabled = true;
  try {
    const result = await api("/api/conversations/outbound", { method:"POST", body:JSON.stringify({
      phone:$("#outbound-phone").value,
      customName:$("#outbound-name").value.trim(),
      template:{ name:state.outboundTemplate.name, language:state.outboundTemplate.language, values },
    }) });
    $("#outbound-dialog").close();
    await loadConversations();
    await openConversation(result.conversationId);
    toast(result.created ? "Conversa criada e template enviado." : "Conversa existente aberta e template enviado.");
  } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; }
});
$("#clear-team-filter").addEventListener("click", () => { state.assignedUser = ""; state.assignedUserActiveOnly = false; loadConversations(); });
$("#enable-notifications").addEventListener("click", async () => {
  if (!("Notification" in window)) return toast("Este dispositivo não oferece notificações do navegador.", true);
  if (Notification.permission === "granted") return toast("Os alertas do sistema já estão ativos.");
  const permission = await Notification.requestPermission();
  configureNotificationButton();
  toast(permission === "granted" ? "Notificações ativadas." : "As notificações não foram autorizadas.", permission !== "granted");
});
$("#theme-toggle").addEventListener("click", () => {
  const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem("mibro-theme", theme); } catch {}
  syncThemeToggle();
});
$("#user-button").addEventListener("click", async () => { await api("/api/auth/logout", { method:"POST" }); location.replace("/login.html"); });
$("#team-button").addEventListener("click", async () => { try { await loadAdminUsers(); resetTeamForm(); $("#new-team-user").hidden = !state.currentUser.isMaster; $("#team-form").hidden = !state.currentUser.isMaster; $("#team-dialog").classList.toggle("activity-only", !state.currentUser.isMaster); $("#team-dialog").showModal(); } catch (e) { toast(e.message, true); } });
$("#close-team").addEventListener("click", () => $("#team-dialog").close());
$("#team-dialog").addEventListener("click", (event) => { if (event.target === $("#team-dialog")) $("#team-dialog").close(); });

$("#contact-details").addEventListener("click", openContactFiles);
$("#signal-transfer").addEventListener("click", async () => {
  if (!state.selectedId) return;

  const toCategoryId =
    $("#subcategory-select").value ||
    $("#category-select").value;

  if (!toCategoryId) {
    return toast("Selecione um setor para sinalizar.", true);
  }

  try {
    await api(
      `/api/conversations/${state.selectedId}/signal-transfer`,
      {
        method: "POST",
        body: JSON.stringify({ toCategoryId }),
      }
    );

    toast("Encaminhamento sinalizado no chat interno.");
  } catch (error) {
    toast(error.message, true);
  }
});
$("#edit-contact-name").addEventListener("click", async () => {
  if (!state.selectedContactId || !state.selectedId) return;

  const conversation = state.conversations.find(
    (item) => item.id === state.selectedId
  );

  const currentCustomName = conversation?.contact?.customName || "";

  const value = prompt(
    "Nome personalizado do contato:\n\nDeixe vazio para voltar ao nome recebido pelo WhatsApp.",
    currentCustomName
  );

  if (value === null) return;

  try {
    await api(`/api/contacts/${state.selectedContactId}/name`, {
      method: "PATCH",
      body: JSON.stringify({
        customName: value.trim(),
      }),
    });

    toast(
      value.trim()
        ? "Nome do contato atualizado."
        : "Nome personalizado removido."
    );

    state.selectedHeaderSignature = "";
    state.listSignature = "";

    await Promise.all([
      loadConversations(),
      openConversation(state.selectedId, { markRead: false }),
    ]);
  } catch (error) {
    toast(error.message, true);
  }
});
$("#close-contact-files").addEventListener("click", () => $("#contact-files-dialog").close());
$("#contact-files-dialog").addEventListener("click", (event) => { if (event.target === $("#contact-files-dialog")) $("#contact-files-dialog").close(); });
$(".contact-files-tabs").addEventListener("click", (event) => {
  const tab = event.target.closest("[data-files-tab]")?.dataset.filesTab;
  if (tab) renderContactFiles(tab);
});
$("#new-team-user").addEventListener("click", resetTeamForm);
$("#cancel-team-edit").addEventListener("click", resetTeamForm);
$("#team-role").addEventListener("change", syncMasterForm);
$("#open-audit").addEventListener("click", async () => {
  if (!state.currentUser?.isMaster) return;
  $("#team-dialog").close();
  try { await loadAuditLogs(); $("#audit-dialog").showModal(); }
  catch (e) { toast(e.message, true); }
});
$("#close-audit").addEventListener("click", () => $("#audit-dialog").close());
$("#audit-dialog").addEventListener("click", (event) => { if (event.target === $("#audit-dialog")) $("#audit-dialog").close(); });
$("#audit-filter-form").addEventListener("submit", async (event) => { event.preventDefault(); try { await loadAuditLogs(); } catch (e) { toast(e.message, true); } });
$("#team-user-list").addEventListener("click", (event) => {
  const edit = event.target.closest("[data-edit-user]");
  if (edit) return editTeamUser(edit.dataset.editUser);
  const view = event.target.closest("[data-view-user]");
  if (view) { state.assignedUser = view.dataset.viewUser; state.assignedUserActiveOnly = true; state.status = ""; state.category = ""; $("#team-dialog").close(); loadConversations(); }
});
$("#team-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = $("#team-password").value;
  const body = {
    name: $("#team-name").value.trim(), email: $("#team-email").value.trim(), role: $("#team-role").value,
    canViewUncategorized: $("#permission-uncategorized").checked,
    canManageCategories: $("#permission-categories").checked,
    canTransferConversations: $("#permission-transfer").checked,
    canViewTeamActivity: $("#permission-team").checked,
    canViewConversationHistory: $("#permission-history").checked,
    canViewPreviousMessages: $("#permission-previous-messages").checked,
    categoryIds: [...document.querySelectorAll("#team-category-access .team-category-access-input:checked")].map((input) => input.value),
  };
  if (password) body.password = password;
  if (state.editingUserId) body.active = $("#team-active").checked;
  const submit = event.submitter; submit.disabled = true;
  try {
    const editing = Boolean(state.editingUserId);
    await api(editing ? `/api/admin/users/${state.editingUserId}` : "/api/admin/users", { method:editing ? "PATCH" : "POST", body:JSON.stringify(body) });
    toast(editing ? "Conta atualizada." : "Conta criada.");
    await Promise.all([loadAdminUsers(), loadUsers()]);
    resetTeamForm();
  } catch (e) { toast(e.message, true); }
  finally { submit.disabled = false; }
});
$("#notes-toggle").addEventListener("click", () => { $("#history-panel").classList.remove("open"); $("#notes-panel").classList.toggle("open"); });
$("#notes-close").addEventListener("click", () => $("#notes-panel").classList.remove("open"));
$("#history-toggle").addEventListener("click", () => { $("#notes-panel").classList.remove("open"); $("#history-panel").classList.toggle("open"); });
$("#history-close").addEventListener("click", () => $("#history-panel").classList.remove("open"));
$("#note-form").addEventListener("submit", async (event) => { event.preventDefault(); const input = $("#note-input"); const content = input.value.trim(); if (!content) return; try { await api(`/api/contacts/${state.selectedContactId}/notes`, { method:"POST", body:JSON.stringify({ content, conversationId:state.selectedId }) }); input.value = ""; toast("Nota adicionada ao contato."); await openConversation(state.selectedId); $("#notes-panel").classList.add("open"); } catch (e) { toast(e.message, true); } });
$("#notes-list").addEventListener("click", async (event) => {
  const deleteButton = event.target.closest(".delete-note");
  if (deleteButton) {
    if (!confirm("Apagar esta nota permanentemente? A ação ficará registrada no histórico.")) return;
    deleteButton.disabled = true;
    try {
      await api(`/api/contacts/${state.selectedContactId}/notes/${deleteButton.dataset.noteId}`, { method:"DELETE", body:JSON.stringify({ conversationId:state.selectedId }) });
      toast("Nota apagada."); await openConversation(state.selectedId); $("#notes-panel").classList.add("open");
    } catch (e) { deleteButton.disabled = false; toast(e.message, true); }
    return;
  }
  const button = event.target.closest(".pin-note"); if (!button) return; button.disabled = true; const pinned = button.dataset.pinned !== "true";
  try { await api(`/api/contacts/${state.selectedContactId}/notes/${button.dataset.noteId}`, { method:"PATCH", body:JSON.stringify({ pinned, conversationId:state.selectedId }) }); toast(pinned ? "Nota fixada no topo." : "Nota desafixada."); await openConversation(state.selectedId); $("#notes-panel").classList.add("open"); } catch (e) { button.disabled = false; toast(e.message, true); }
});
$("#pin-conversation").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const conversationId = state.selectedId;
  if (!conversationId || button.disabled) return;
  const pinned = button.dataset.pinned !== "true";
  button.disabled = true;
  button.textContent = pinned ? "★ Fixando..." : "☆ Desfixando...";
  try {
    const result = await api(`/api/conversations/${conversationId}/pin`, { method:"PATCH", body:JSON.stringify({ pinned }) });
    if (state.selectedId === conversationId) {
      button.dataset.pinned = String(result.pinned);
      button.textContent = result.pinned ? "★ Fixada" : "☆ Fixar";
      const listed = state.conversations.find((conversation) => conversation.id === conversationId);
      if (listed) listed.isPinned = result.pinned;
      state.selectedHeaderSignature = "";
      state.listSignature = "";
    }
    toast(result.pinned ? "Conversa fixada para sua conta." : "Conversa desafixada.");
    if (state.selectedId === conversationId) await openConversation(conversationId, { markRead:false });
    else await loadConversations();
  } catch (e) {
    if (state.selectedId === conversationId) button.textContent = pinned ? "☆ Fixar" : "★ Fixada";
    toast(e.message, true);
  } finally { button.disabled = false; }
});
function openConversationCategoryTransfer() {
  if ($("#confirm-category").disabled) return;
  const primary = $("#category-select").selectedOptions[0]?.textContent || "Sem categoria";
  const secondary = $("#subcategory-select").value ? $("#subcategory-select").selectedOptions[0]?.textContent : "";
  $("#transfer-destination").textContent = `Destino: ${secondary ? `${primary}: ${secondary}` : primary}`;
  $("#transfer-limit-history").checked = false;
  $("#transfer-dialog").showModal();
}
async function confirmConversationCategory(event) {
  event.preventDefault();
  const button = $("#confirm-category");
  const categoryId = pendingCategoryId();
  if (!state.selectedId || categoryId === state.selectedCategoryId) return;
  const submit = event.submitter;
  submit.disabled = true;
  button.disabled = true;
  try {
    await api(`/api/conversations/${state.selectedId}`, { method:"PATCH", body:JSON.stringify({
      categoryId:categoryId || null, limitHistory:$("#transfer-limit-history").checked,
    }) });
    $("#transfer-dialog").close();
    toast("Conversa transferida para a categoria selecionada.");
    closeConversationView();
    await loadConversations();
  } catch (e) {
    $("#transfer-dialog").close();
    toast(e.message, true);
    await openConversation(state.selectedId, { markRead:false });
  } finally { submit.disabled = false; syncCategoryConfirmation(); }
}
$("#category-select").addEventListener("change", (event) => {
  const primaryId = event.target.value;
  populateSubcategorySelect(primaryId);
  syncCategoryConfirmation();
});
$("#subcategory-select").addEventListener("change", syncCategoryConfirmation);
$("#confirm-category").addEventListener("click", openConversationCategoryTransfer);
$("#transfer-form").addEventListener("submit", confirmConversationCategory);
$("#close-transfer").addEventListener("click", () => $("#transfer-dialog").close());
$("#cancel-transfer").addEventListener("click", () => $("#transfer-dialog").close());
$("#transfer-dialog").addEventListener("click", (event) => { if (event.target === $("#transfer-dialog")) $("#transfer-dialog").close(); });
$("#assignee-select").addEventListener("change", async (event) => { try { await api(`/api/conversations/${state.selectedId}`, { method:"PATCH", body:JSON.stringify({ assignedUserId:event.target.value || null }) }); toast(event.target.value ? "Responsável atualizado." : "Conversa sem responsável."); await openConversation(state.selectedId); } catch (e) { toast(e.message, true); } });
$("#toggle-hidden-categories").addEventListener("click", async () => {
  state.visibilityMode = !state.visibilityMode;
  $("#toggle-hidden-categories").classList.toggle("active", state.visibilityMode);
  $("#toggle-hidden-categories").title = state.visibilityMode ? "Ocultar categorias escondidas" : "Mostrar categorias ocultas";
  state.categorySignature = ""; await loadCategories();
});
$("#claim-conversation").addEventListener("click", async () => { try { await api(`/api/conversations/${state.selectedId}/claim`, { method:"POST" }); toast("Conversa atribuída a você."); await openConversation(state.selectedId); } catch (e) { toast(e.message, true); } });
$("#manage-categories").addEventListener("click", () => { renderCategoryManager(); $("#category-dialog").showModal(); });
$("#close-categories").addEventListener("click", () => $("#category-dialog").close());
$("#category-dialog").addEventListener("click", (event) => { if (event.target === $("#category-dialog")) $("#category-dialog").close(); });
$("#category-form").addEventListener("submit", async (event) => { event.preventDefault(); const name = $("#category-name").value.trim(); const color = $("#category-color").value; const parentId = $("#category-parent").value || null; try { await api("/api/categories", { method:"POST", body:JSON.stringify({ name, color, parentId }) }); $("#category-name").value = ""; await loadCategories(); await loadConversations(); toast(parentId ? "Subcategoria criada." : "Categoria criada."); } catch (e) { toast(e.message, true); } });
$("#category-manager-list").addEventListener("submit", async (event) => { event.preventDefault(); const row = event.target.closest("[data-category-id]"); const name = row.querySelector(".managed-name").value.trim(); const color = row.querySelector(".managed-color").value; const parentId = row.querySelector(".managed-parent").value || null; const active = row.querySelector(".managed-active").checked; try { await api(`/api/categories/${row.dataset.categoryId}`, { method:"PATCH", body:JSON.stringify({ name, color, parentId, active }) }); await loadCategories(); await loadConversations(); toast("Categoria atualizada."); } catch (e) { toast(e.message, true); } });
$("#category-manager-list").addEventListener("change", (event) => { if (event.target.classList.contains("managed-active")) event.target.closest("label").querySelector("span").textContent = event.target.checked ? "Ativa" : "Inativa"; });
$("#toggle-finalized").addEventListener("click", async (event) => {
  const button = event.currentTarget; const reopening = button.dataset.status === "FINALIZADO";
  button.disabled = true;
  try {
    if (reopening) {
      await api(`/api/conversations/${state.selectedId}`, { method:"PATCH", body:JSON.stringify({ status:"NOVO" }) });
      toast("Atendimento reaberto.");
    } else {
      await api(`/api/conversations/${state.selectedId}/finalize`, { method:"POST" });
      toast("Mensagem de encerramento enviada e atendimento finalizado.");
    }
    await openConversation(state.selectedId);
  } catch (e) { toast(e.message, true); }
  finally { button.disabled = false; }
});
$("#delete-conversation").addEventListener("click", async (event) => {
  const conversationId = state.selectedId;
  if (!conversationId || !state.currentUser?.isMaster) return;
  if (!confirm("Apagar esta conversa permanentemente? Todas as mensagens e o histórico desta conversa serão excluídos.")) return;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await api(`/api/conversations/${conversationId}`, { method:"DELETE" });
    closeConversationView();
    await loadConversations();
    toast("Conversa apagada.");
  } catch (e) { toast(e.message, true); }
  finally { button.disabled = false; }
});
let selectedAttachment = null;
let attachmentUrl = null;
function clearSelectedAttachment() {
  selectedAttachment = null; $("#attachment-input").value = ""; $("#attachment-preview").hidden = true;
  $("#attachment-thumb").hidden = false; $("#attachment-type").hidden = true;
  $("#message-input").maxLength = 4096;
  if (attachmentUrl) URL.revokeObjectURL(attachmentUrl); attachmentUrl = null;
}

function selectAttachmentFile(file) {
  if (!file) return clearSelectedAttachment();

  const isImage = ["image/jpeg", "image/png"].includes(file.type);
  const isDocument = isDocumentMime(file.type);
  const isVideo = ["video/mp4", "video/3gpp", "video/3gp"].includes(file.type);

  if (!isImage && !isDocument && !isVideo) {
    clearSelectedAttachment();

    return toast(
      "Envie uma imagem JPG/PNG, vídeo MP4/3GP ou documento PDF/TXT/Word/Excel/PowerPoint.",
      true
    );
  }

  if (isImage && file.size > 5 * 1024 * 1024) {
    clearSelectedAttachment();
    return toast("A imagem deve ter no máximo 5 MB.", true);
  }

  if (isVideo && file.size > 16 * 1024 * 1024) {
    clearSelectedAttachment();
    return toast("O vídeo deve ter no máximo 16 MB.", true);
  }

  if (isDocument && file.size > 100 * 1024 * 1024) {
    clearSelectedAttachment();
    return toast("O documento deve ter no máximo 100 MB.", true);
  }

  if (attachmentUrl) {
    URL.revokeObjectURL(attachmentUrl);
  }

  attachmentUrl = null;
  selectedAttachment = file;

  $("#attachment-thumb").hidden = !isImage;
  $("#attachment-type").hidden = isImage;

  $("#attachment-type").textContent = isDocument
    ? documentTypeLabel(file.type, file.name)
    : "VÍDEO";

  if (isImage) {
    attachmentUrl = URL.createObjectURL(file);
    $("#attachment-thumb").src = attachmentUrl;
  }

  $("#message-input").maxLength = 1024;
  $("#attachment-name").textContent = file.name || "Imagem colada";
  $("#attachment-preview").hidden = false;
  $("#message-input").focus();
}

$("#attachment-input").addEventListener("change", (event) => {
  selectAttachmentFile(event.target.files[0]);
});

$("#message-input").addEventListener("paste", (event) => {
  const files = Array.from(event.clipboardData?.files || []);

  const image = files.find((file) =>
    ["image/jpeg", "image/png"].includes(file.type)
  );

  if (!image) return;

  event.preventDefault();

  const extension =
    image.type === "image/jpeg"
      ? "jpg"
      : "png";

  const pastedImage = new File(
    [image],
    `imagem-colada-${Date.now()}.${extension}`,
    {
      type: image.type,
    }
  );

  selectAttachmentFile(pastedImage);
});

$("#message-input").addEventListener("paste", (event) => {
  const items = Array.from(event.clipboardData?.items || []);

  const imageItem = items.find(
    (item) =>
      item.kind === "file" &&
      ["image/png", "image/jpeg"].includes(item.type)
  );

  if (!imageItem) return;

  const file = imageItem.getAsFile();
  if (!file) return;

  event.preventDefault();

  const extension =
    file.type === "image/jpeg"
      ? "jpg"
      : "png";

  const pastedImage = new File(
    [file],
    `imagem-colada-${Date.now()}.${extension}`,
    { type: file.type }
  );

  const transfer = new DataTransfer();
  transfer.items.add(pastedImage);

  const input = $("#attachment-input");
  input.files = transfer.files;

  input.dispatchEvent(
    new Event("change", { bubbles: true })
  );
});

$("#remove-attachment").addEventListener("click", clearSelectedAttachment);
$("#composer").addEventListener("submit", async (event) => { event.preventDefault(); const input = $("#message-input"); const text = input.value.trim(); if (!text && !selectedAttachment) return; $("#send-button").disabled = true; try { if (selectedAttachment) { const isDocument = isDocumentMime(selectedAttachment.type); const isVideo = selectedAttachment.type.startsWith("video/"); const field = isDocument ? "document" : (isVideo ? "video" : "image"); const endpoint = isDocument ? "documents" : (isVideo ? "videos" : "images"); const form = new FormData(); form.append(field, selectedAttachment); if (text) form.append("caption", text); await api(`/api/conversations/${state.selectedId}/${endpoint}`, { method:"POST", body:form }); clearSelectedAttachment(); } else { await api(`/api/conversations/${state.selectedId}/messages`, { method:"POST", body:JSON.stringify({ text }) }); } input.value = ""; await openConversation(state.selectedId); } catch (e) { if (e.customerServiceWindow) state.customerServiceWindow = e.customerServiceWindow; toast(e.message, true); } finally { syncCustomerServiceWindow(); input.focus(); } });
$("#open-templates").addEventListener("click", openTemplates);
$("#open-required-template").addEventListener("click", openTemplates);
$("#close-templates").addEventListener("click", () => $("#template-dialog").close());
$("#template-dialog").addEventListener("click", (event) => { if (event.target === $("#template-dialog")) $("#template-dialog").close(); });
$("#template-search").addEventListener("input", renderTemplateList);
$("#template-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.selectedTemplate || !state.selectedId) return;
  const values = Object.fromEntries([...document.querySelectorAll("[data-template-variable]")].map((input) => [input.dataset.templateVariable, input.value.trim()]));
  $("#send-template").disabled = true;
  try {
    await api(`/api/conversations/${state.selectedId}/templates`, { method:"POST", body:JSON.stringify({ name:state.selectedTemplate.name, language:state.selectedTemplate.language, values }) });
    $("#template-dialog").close();
    toast("Template enviado para o cliente.");
    await openConversation(state.selectedId);
  } catch (error) { toast(error.message, true); }
  finally { $("#send-template").disabled = false; }
});
$("#message-input").addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); $("#composer").requestSubmit(); } });
$(".chat-header").addEventListener("click", (event) => { if (innerWidth <= 700 && event.offsetX < 45) $("#chat-panel").classList.remove("open"); });

syncThemeToggle();
loadCurrentUser()
  .then(() => Promise.all([loadUsers(), loadCategories(), loadMetaStatus()]))
  .then(loadAdminUsers)
  .then(loadConversations)
  .then(async () => {
    const requestedConversation = new URLSearchParams(location.search).get("conversation");
    if (requestedConversation) {
      history.replaceState({}, "", "/");
      try { await openConversation(requestedConversation); } catch {}
    }
    await checkAlerts();
  })
  .then(connectRealtime)
  .catch((error) => toast(error.message, true));
setInterval(() => { (document.hidden ? checkAlerts() : refreshInbox()).catch(() => {}); }, 30000);
