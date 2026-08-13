const state = {
  conversations: [], categories: [], users: [], currentUser: null,
  selectedId: null, selectedContactId: null, selectedCategoryId: "", status: "", category: "", search: "",
  categorySignature: "", listSignature: "", selectedHeaderSignature: "",
  selectedMessagesSignature: "", selectedNotesSignature: "", selectedActivitiesSignature: "", selectedMessageItems: [],
  expandedCategories: new Set(), adminUsers: [], editingUserId: null, assignedUser: "",
  assignedUserActiveOnly: false, alertCursor: null, checkingAlerts: false,
};
const $ = (selector) => document.querySelector(selector);
const defaultDocumentTitle = document.title;
let waitingTitleTimer = null;
let waitingAlertCount = 0;
let conversationLoadSequence = 0;
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[char]);
const initials = (name = "?") => name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
const time = (value) => value ? new Intl.DateTimeFormat("pt-BR", { hour:"2-digit", minute:"2-digit" }).format(new Date(value)) : "";
const statusLabel = (value) => ({ NOVO:"Novo", EM_ATENDIMENTO:"Em atendimento", AGUARDANDO_RESPOSTA:"Aguardando resposta", BOT:"Bot", FINALIZADO:"Finalizado" })[value] || value;
const categoryLabel = (category) => category?.parent?.name ? `${category.parent.name}: ${category.name}` : (category?.name || "Sem categoria");
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
  return message.text || `[${message.type}]`;
};

function conversationSignature(conversation) {
  const lastMessage = conversation.messages?.[0];
  const note = conversation.contact.notes?.[0];
  return JSON.stringify([
    conversation.id, conversation.id === state.selectedId, conversation.status, conversation.unreadCount, conversation.lastMessageAt,
    conversation.categoryId, conversation.category?.name, conversation.category?.color, conversation.category?.parent?.name,
    conversation.assignedUserId, conversation.assignedUser?.name,
    conversation.isPinned,
    conversation.contact.name, conversation.contact.phone, conversation.contact._count?.notes,
    note?.id, note?.content,
    lastMessage?.id, lastMessage?.text, lastMessage?.type,
  ]);
}

function conversationCardMarkup(c) {
  const last = c.messages[0]; const name = c.contact.name || c.contact.phone; const note = c.contact.notes?.[0];
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
  if (message.type === "image") return "<p>[Imagem indisponível]</p>";
  if (message.type === "audio") return "<p>[Áudio indisponível]</p>";
  if (message.type === "video") return "<p>[Vídeo indisponível]</p>";
  if (message.type === "sticker") return "<p>[Figurinha indisponível]</p>";
  return `<p>${escapeHtml(message.text || `[${message.type}]`)}</p>`;
}

function messageRowMarkup(message) {
  const [symbol, label, statusClass] = deliveryStatus(message.status);
  return `<div class="message-row ${message.direction === "ENVIADA" ? "sent" : "received"}" data-message-id="${escapeHtml(message.id)}"><div class="bubble ${["image", "audio", "video", "sticker"].includes(message.type) ? `${message.type}-bubble` : ""} ${message.reactionEmoji ? "has-reaction" : ""}">${messageContent(message)}<footer>${message.sentByUser ? `<span class="author">${escapeHtml(message.sentByUser.name)}</span>` : ""}<span>${time(message.occurredAt)}</span>${message.direction === "ENVIADA" ? `<span class="delivery-status ${statusClass}" title="${label}" aria-label="${label}">${symbol}</span>` : ""}</footer>${message.reactionEmoji ? `<span class="message-reaction" title="Reação do cliente">${escapeHtml(message.reactionEmoji)}</span>` : ""}</div></div>`;
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
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir a operação.");
  return data;
}
function toast(message, error = false) { const el = $("#toast"); el.textContent = message; el.className = `toast show${error ? " error" : ""}`; setTimeout(() => el.className = "toast", 2600); }

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
    toast(result.alerts.length === 1 ? `${latest.title}: ${latest.text}` : `${result.alerts.length} novos alertas de atendimento.`);
    if (document.hidden && typeof window.mibroNotify === "function") {
      for (const alert of result.alerts.slice(-3)) {
        await window.mibroNotify(alert.title, {
          body: alert.text, tag: alert.id, data: { url: `/?conversation=${encodeURIComponent(alert.conversationId)}` },
        });
      }
    }
  } catch (error) {
    console.warn("Não foi possível consultar os alertas.", error);
  } finally { state.checkingAlerts = false; }
}

async function loadCategories() {
  const previousPrimaryCategory = $("#category-select").value;
  const previousSubcategory = $("#subcategory-select").value;
  const categories = await api("/api/categories");
  const signature = JSON.stringify(categories.map((category) => [category.id, category.parentId, category.parent?.name, category.code, category.name, category.color, category.active, category.displayOrder]));
  state.categories = categories;
  if (signature === state.categorySignature) return;
  state.categorySignature = signature;
  state.selectedHeaderSignature = "";
  const activeIds = new Set(state.categories.filter((category) => category.active).map((category) => category.id));
  const activeCategories = orderedCategories(state.categories.filter((category) => category.active && (!category.parentId || activeIds.has(category.parentId))));
  if (state.category && !activeCategories.some((c) => c.code === state.category)) state.category = "";
  const roots = activeCategories.filter((category) => !category.parentId);
  $("#category-filters").innerHTML = roots.map((root) => {
    const children = activeCategories.filter((category) => category.parentId === root.id);
    const expanded = state.expandedCategories.has(root.id);
    return `<div class="category-filter-group"><button class="filter category-parent-filter" data-category="${root.code}" data-category-group="${root.id}" aria-expanded="${expanded}"><span><i class="category-dot" style="background:${root.color || "#999"}"></i>${escapeHtml(root.name)}${children.length ? `<i class="category-chevron" aria-hidden="true">${expanded ? "⌃" : "⌄"}</i>` : ""}</span><strong data-category-count="${root.id}">0</strong></button>${children.length ? `<div class="subcategory-filters" data-category-children="${root.id}" ${expanded ? "" : "hidden"}>${children.map((child) => `<button class="filter subcategory-filter" data-category="${child.code}"><span><i class="category-dot" style="background:${child.color || root.color || "#999"}"></i>↳ ${escapeHtml(child.name)}</span><strong data-category-count="${child.id}">0</strong></button>`).join("")}</div>` : ""}</div>`;
  }).join("");
  $("#category-select").innerHTML = `${state.currentUser?.canViewUncategorized ? `<option value="">Sem categoria</option>` : `<option value="" disabled>Selecione a categoria</option>`}` + roots.map((category) => `<option value="${category.id}" data-selectable="${category.selectable !== false}">${escapeHtml(category.name)}</option>`).join("");
  $("#category-parent").innerHTML = `<option value="">Categoria principal</option>` + roots.map((category) => `<option value="${category.id}">${escapeHtml(category.name)}</option>`).join("");
  if ([...$("#category-select").options].some((option) => option.value === previousPrimaryCategory)) $("#category-select").value = previousPrimaryCategory;
  populateSubcategorySelect($("#category-select").value, previousSubcategory);
  document.querySelectorAll("[data-category]").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.categoryGroup) {
      const groupId = button.dataset.categoryGroup; const children = document.querySelector(`[data-category-children="${groupId}"]`);
      if (children) {
        children.hidden = !children.hidden;
        button.setAttribute("aria-expanded", String(!children.hidden));
        button.querySelector(".category-chevron").textContent = children.hidden ? "⌄" : "⌃";
        if (children.hidden) state.expandedCategories.delete(groupId); else state.expandedCategories.add(groupId);
      }
    }
    document.querySelectorAll(".filter").forEach((item) => item.classList.remove("active")); button.classList.add("active"); state.category = button.dataset.category; state.status = ""; loadConversations();
  }));
  document.querySelectorAll(".filter").forEach((item) => item.classList.remove("active"));
  const selectedFilter = state.category
    ? [...document.querySelectorAll("[data-category]")].find((item) => item.dataset.category === state.category)
    : [...document.querySelectorAll("[data-status]")].find((item) => item.dataset.status === state.status);
  selectedFilter?.classList.add("active");
  if (selectedFilter?.closest(".subcategory-filters")) {
    const children = selectedFilter.closest(".subcategory-filters"); const groupId = children.dataset.categoryChildren;
    children.hidden = false; state.expandedCategories.add(groupId);
    const parentButton = document.querySelector(`[data-category-group="${groupId}"]`);
    parentButton?.setAttribute("aria-expanded", "true");
    if (parentButton?.querySelector(".category-chevron")) parentButton.querySelector(".category-chevron").textContent = "⌃";
  }
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
    contact: [c.contact.id, c.contact.name, c.contact.phone],
    messageHistoryLimited: c.messageHistoryLimited,
  });
  const displayMessages = messagesWithReactions(c.messages);
  const hasReactionEvents = displayMessages.length !== c.messages.length;
  const messageItems = displayMessages.map((message) => JSON.stringify([message.id, message.externalId, message.direction, message.type, message.text, message.occurredAt, message.mediaStorageKey, message.mediaMimeType, message.reactionEmoji, message.sentByUser?.id, message.sentByUser?.name]));
  const messagesSignature = JSON.stringify([c.messageHistoryLimited, messageItems]);
  const notesSignature = JSON.stringify((c.contact.notes || []).map((note) => [note.id, note.content, note.pinned, note.createdAt, note.updatedAt, note.author?.name]));
  const activitiesSignature = JSON.stringify((c.activities || []).map((activity) => [activity.id, activity.action, activity.details, activity.createdAt, activity.actorUser?.name]));
  state.selectedContactId = c.contact.id;
  $("#empty-state").hidden = true; $("#chat-content").hidden = false; $("#chat-panel").classList.add("open");
  if (headerSignature !== state.selectedHeaderSignature) {
    state.selectedHeaderSignature = headerSignature;
    const name = c.contact.name || c.contact.phone;
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
      $("#messages").insertAdjacentHTML("beforeend", displayMessages.slice(state.selectedMessageItems.length).map(messageRowMarkup).join(""));
    } else {
      $("#messages").innerHTML = `${c.messageHistoryLimited ? `<div class="limited-history-notice">As mensagens anteriores ao encaminhamento estão ocultas para esta conta.</div>` : ""}${displayMessages.map(messageRowMarkup).join("")}`;
    }
    state.selectedMessageItems = messageItems;
    $("#messages").scrollTop = $("#messages").scrollHeight;
  }
  syncMessageStatuses(displayMessages);
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
    if (state.selectedId) await openConversation(state.selectedId, { refreshList:false, markRead:false });
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
    AUTO_FINALIZED_INACTIVITY: `Sistema finalizou a conversa após ${details.inactivityMinutes || 15} minutos sem resposta do cliente`,
  })[activity.action] || "realizou uma atualização na conversa";
}

function renderActivities(activities) {
  $("#history-list").innerHTML = activities.length ? activities.map((activity) => `<article class="history-item"><span class="history-dot" aria-hidden="true"></span><div><p><b>${escapeHtml(activity.actorUser?.name || "Sistema")}</b> ${escapeHtml(activityText(activity))}</p><time>${new Intl.DateTimeFormat("pt-BR", { dateStyle:"short", timeStyle:"short" }).format(new Date(activity.createdAt))}</time></div></article>`).join("") : `<div class="notes-empty">Nenhuma ação registrada ainda.</div>`;
}

const roleLabel = (role) => ({ ADMIN:"Master", SUPERVISOR:"Supervisor", ATENDENTE:"Atendente" })[role] || role;

function renderTeamCategoryAccess(selectedIds = []) {
  const selected = new Set(selectedIds);
  const active = state.categories.filter((category) => category.active);
  const roots = active.filter((category) => !category.parentId);
  $("#team-category-access").innerHTML = `<div class="team-category-groups">${roots.map((root) => {
    const children = active.filter((category) => category.parentId === root.id);
    const rootSelected = selected.has(root.id);
    return `<section class="team-category-group" data-category-group="${escapeHtml(root.id)}">
      <label class="team-category-option root"><input class="team-category-root" type="checkbox" value="${escapeHtml(root.id)}" ${rootSelected ? "checked" : ""}><i class="category-dot" style="background:${root.color || "#999"}"></i><span><b>${escapeHtml(root.name)}</b><small>${children.length ? `${children.length} subcategoria${children.length === 1 ? "" : "s"}` : "Categoria principal"}</small></span></label>
      ${children.length ? `<div class="team-subcategory-list">${children.map((child) => `<label class="team-category-option child"><input type="checkbox" value="${escapeHtml(child.id)}" ${selected.has(child.id) ? "checked" : ""}><i class="category-dot" style="background:${child.color || root.color || "#999"}"></i><span>${escapeHtml(child.name)}</span></label>`).join("")}</div>` : ""}
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
  $("#permission-uncategorized").checked = user.canViewUncategorized;
  $("#permission-categories").checked = user.canManageCategories;
  $("#permission-transfer").checked = user.canTransferConversations;
  $("#permission-team").checked = user.canViewTeamActivity;
  $("#permission-history").checked = user.canViewConversationHistory;
  $("#permission-previous-messages").checked = user.canViewPreviousMessages;
  $("#team-form-eyebrow").textContent = "EDITAR CONTA";
  $("#team-form-title").textContent = user.name;
  renderTeamCategoryAccess(user.categoryAccess.map((access) => access.categoryId));
  syncMasterForm();
}

function renderAdminUsers() {
  $("#team-count").textContent = `${state.adminUsers.length} conta${state.adminUsers.length === 1 ? "" : "s"}`;
  $("#team-user-list").innerHTML = state.adminUsers.map((user) => `<article class="team-user-card ${user.active ? "" : "inactive"}"><div class="team-user-main"><span class="team-user-avatar">${escapeHtml(initials(user.name))}</span><span class="team-user-info"><b>${escapeHtml(user.name)}</b><small>${escapeHtml(user.email || "Membro da equipe")}</small></span><span class="role-pill">${escapeHtml(roleLabel(user.role))}</span></div><div class="team-user-meta"><span>${user._count.assignedConversations} conversa(s) atribuída(s)</span>${state.currentUser?.isMaster ? `<span>•</span><span>${user._count.sentMessages} resposta(s)</span>` : ""}${user.active ? "" : "<span>• Inativa</span>"}</div><div class="team-user-actions">${state.currentUser?.isMaster ? `<button type="button" data-edit-user="${escapeHtml(user.id)}">Editar</button>` : ""}<button type="button" data-view-user="${escapeHtml(user.id)}">Ver atendimentos</button></div></article>`).join("");
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
$("#new-team-user").addEventListener("click", resetTeamForm);
$("#cancel-team-edit").addEventListener("click", resetTeamForm);
$("#team-role").addEventListener("change", syncMasterForm);
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
    categoryIds: [...document.querySelectorAll("#team-category-access input:checked")].map((input) => input.value),
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
async function confirmConversationCategory() {
  const button = $("#confirm-category");
  const categoryId = pendingCategoryId();
  if (button.disabled) return;
  button.disabled = true;
  try {
    await api(`/api/conversations/${state.selectedId}`, { method:"PATCH", body:JSON.stringify({ categoryId:categoryId || null }) });
    toast("Conversa transferida para a categoria selecionada.");
    closeConversationView();
    await loadConversations();
  } catch (e) {
    toast(e.message, true);
    await openConversation(state.selectedId, { markRead:false });
  } finally { syncCategoryConfirmation(); }
}
$("#category-select").addEventListener("change", (event) => {
  const primaryId = event.target.value;
  populateSubcategorySelect(primaryId);
  syncCategoryConfirmation();
});
$("#subcategory-select").addEventListener("change", syncCategoryConfirmation);
$("#confirm-category").addEventListener("click", confirmConversationCategory);
$("#assignee-select").addEventListener("change", async (event) => { try { await api(`/api/conversations/${state.selectedId}`, { method:"PATCH", body:JSON.stringify({ assignedUserId:event.target.value || null }) }); toast(event.target.value ? "Responsável atualizado." : "Conversa sem responsável."); await openConversation(state.selectedId); } catch (e) { toast(e.message, true); } });
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
let selectedImage = null;
let attachmentUrl = null;
function clearSelectedImage() {
  selectedImage = null; $("#image-input").value = ""; $("#attachment-preview").hidden = true;
  $("#message-input").maxLength = 4096;
  if (attachmentUrl) URL.revokeObjectURL(attachmentUrl); attachmentUrl = null;
}
$("#image-input").addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return clearSelectedImage();
  if (!["image/jpeg", "image/png"].includes(file.type)) { clearSelectedImage(); return toast("Envie uma imagem JPG ou PNG.", true); }
  if (file.size > 5 * 1024 * 1024) { clearSelectedImage(); return toast("A imagem deve ter no máximo 5 MB.", true); }
  selectedImage = file; attachmentUrl = URL.createObjectURL(file); $("#attachment-thumb").src = attachmentUrl;
  $("#message-input").maxLength = 1024;
  $("#attachment-name").textContent = file.name; $("#attachment-preview").hidden = false; $("#message-input").focus();
});
$("#remove-attachment").addEventListener("click", clearSelectedImage);
$("#composer").addEventListener("submit", async (event) => { event.preventDefault(); const input = $("#message-input"); const text = input.value.trim(); if (!text && !selectedImage) return; $("#send-button").disabled = true; try { if (selectedImage) { const form = new FormData(); form.append("image", selectedImage); if (text) form.append("caption", text); await api(`/api/conversations/${state.selectedId}/images`, { method:"POST", body:form }); clearSelectedImage(); } else { await api(`/api/conversations/${state.selectedId}/messages`, { method:"POST", body:JSON.stringify({ text }) }); } input.value = ""; await openConversation(state.selectedId); } catch (e) { toast(e.message, true); } finally { $("#send-button").disabled = false; input.focus(); } });
$("#message-input").addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); $("#composer").requestSubmit(); } });
$(".chat-header").addEventListener("click", (event) => { if (innerWidth <= 700 && event.offsetX < 45) $("#chat-panel").classList.remove("open"); });

syncThemeToggle();
loadCurrentUser()
  .then(() => Promise.all([loadUsers(), loadCategories()]))
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
