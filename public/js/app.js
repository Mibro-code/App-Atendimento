const state = {
  conversations: [], categories: [], users: [], currentUser: null,
  selectedId: null, selectedContactId: null, status: "", category: "", search: "",
  categorySignature: "", listSignature: "", selectedHeaderSignature: "",
  selectedMessagesSignature: "", selectedNotesSignature: "", selectedMessageItems: [],
};
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[char]);
const initials = (name = "?") => name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
const time = (value) => value ? new Intl.DateTimeFormat("pt-BR", { hour:"2-digit", minute:"2-digit" }).format(new Date(value)) : "";
const statusLabel = (value) => ({ NOVO:"Novo", EM_ATENDIMENTO:"Em atendimento", AGUARDANDO_CLIENTE:"Aguardando cliente", BOT:"Bot", FINALIZADO:"Finalizado" })[value] || value;
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
  return message.text || `[${message.type}]`;
};

function conversationSignature(conversation) {
  const lastMessage = conversation.messages?.[0];
  const note = conversation.contact.notes?.[0];
  return JSON.stringify([
    conversation.id, conversation.id === state.selectedId, conversation.status, conversation.unreadCount, conversation.lastMessageAt,
    conversation.categoryId, conversation.category?.name, conversation.category?.color,
    conversation.assignedUserId, conversation.assignedUser?.name,
    conversation.contact.name, conversation.contact.phone, conversation.contact._count?.notes,
    note?.id, note?.content,
    lastMessage?.id, lastMessage?.text, lastMessage?.type,
  ]);
}

function conversationCardMarkup(c) {
  const last = c.messages[0]; const name = c.contact.name || c.contact.phone; const note = c.contact.notes?.[0];
  return `<button class="conversation-card ${c.id === state.selectedId ? "active" : ""}" data-id="${escapeHtml(c.id)}">
    <span class="card-grip" aria-hidden="true"></span><span class="avatar">${escapeHtml(initials(name))}</span><span class="card-main">
    <span class="card-title"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(c.contact.phone)}</small></span>
    <span class="preview">${escapeHtml(messagePreview(last))}</span>
    <span class="card-labels"><span class="category-label" style="color:${c.category?.color || "#666"};border-color:${c.category?.color || "#aaa"}">${escapeHtml(c.category?.name || "Sem categoria")}</span><span class="status-label">${escapeHtml(statusLabel(c.status))}</span>${c.assignedUser ? `<span class="assignee-label">${escapeHtml(c.assignedUser.name)}</span>` : ""}</span>
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
  if (message.type === "image") return "<p>[Imagem indisponível]</p>";
  if (message.type === "audio") return "<p>[Áudio indisponível]</p>";
  if (message.type === "video") return "<p>[Vídeo indisponível]</p>";
  return `<p>${escapeHtml(message.text || `[${message.type}]`)}</p>`;
}

function messageRowMarkup(message) {
  return `<div class="message-row ${message.direction === "ENVIADA" ? "sent" : "received"}" data-message-id="${escapeHtml(message.id)}"><div class="bubble ${["image", "audio", "video"].includes(message.type) ? `${message.type}-bubble` : ""}">${messageContent(message)}<footer>${message.sentByUser ? `<span class="author">${escapeHtml(message.sentByUser.name)}</span>` : ""}<span>${time(message.occurredAt)}</span></footer></div></div>`;
}

async function loadCurrentUser() {
  const status = await api("/api/auth/status");
  if (!status.authenticated) return location.replace("/login.html");
  state.currentUser = status.user;
  $("#current-user").textContent = status.user.name;
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

async function loadCategories() {
  const previousSelectedCategory = $("#category-select").value;
  const categories = await api("/api/categories");
  const signature = JSON.stringify(categories.map((category) => [category.id, category.code, category.name, category.color, category.active, category.displayOrder]));
  state.categories = categories;
  if (signature === state.categorySignature) return;
  state.categorySignature = signature;
  state.selectedHeaderSignature = "";
  const activeCategories = state.categories.filter((c) => c.active);
  if (state.category && !activeCategories.some((c) => c.code === state.category)) state.category = "";
  $("#category-filters").innerHTML = activeCategories.map((c) => `<button class="filter" data-category="${c.code}"><span><i class="category-dot" style="background:${c.color || "#999"}"></i>${escapeHtml(c.name)}</span><strong data-category-count="${c.id}">0</strong></button>`).join("");
  $("#category-select").innerHTML = `<option value="">Sem categoria</option>` + activeCategories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  if ([...$("#category-select").options].some((option) => option.value === previousSelectedCategory)) $("#category-select").value = previousSelectedCategory;
  document.querySelectorAll("[data-category]").forEach((button) => button.addEventListener("click", () => {
    document.querySelectorAll(".filter").forEach((item) => item.classList.remove("active")); button.classList.add("active"); state.category = button.dataset.category; state.status = ""; loadConversations();
  }));
  document.querySelectorAll(".filter").forEach((item) => item.classList.remove("active"));
  const selectedFilter = state.category
    ? [...document.querySelectorAll("[data-category]")].find((item) => item.dataset.category === state.category)
    : [...document.querySelectorAll("[data-status]")].find((item) => item.dataset.status === state.status);
  selectedFilter?.classList.add("active");
  renderCategoryManager();
}

function renderCategoryManager() {
  $("#category-manager-list").innerHTML = state.categories.map((category) => `<form class="category-manager-row" data-category-id="${category.id}">
    <input class="managed-color" type="color" value="${category.color || "#6b7280"}" aria-label="Cor de ${escapeHtml(category.name)}">
    <input class="managed-name" maxlength="60" value="${escapeHtml(category.name)}" aria-label="Nome da categoria" required>
    <label class="active-switch"><input class="managed-active" type="checkbox" ${category.active ? "checked" : ""}><span>${category.active ? "Ativa" : "Inativa"}</span></label>
    <button type="submit">Salvar</button>
  </form>`).join("");
}

async function loadConversations() {
  const params = new URLSearchParams();
  if (state.search) params.set("search", state.search);
  if (state.status) params.set("status", state.status);
  if (state.category) params.set("category", state.category);
  const [conversations, summary] = await Promise.all([
    api(`/api/conversations?${params}`),
    api("/api/conversations/summary"),
  ]);
  state.conversations = conversations;
  $("#list-summary").textContent = `${state.conversations.length} atendimento${state.conversations.length === 1 ? "" : "s"}`;
  $("#count-all").textContent = summary.total || 0;
  $("#count-new").textContent = summary.statuses.NOVO || 0;
  $("#count-in-progress").textContent = summary.statuses.EM_ATENDIMENTO || 0;
  $("#count-waiting").textContent = summary.statuses.AGUARDANDO_CLIENTE || 0;
  $("#count-bot").textContent = summary.statuses.BOT || 0;
  $("#count-finalized").textContent = summary.statuses.FINALIZADO || 0;
  document.querySelectorAll("[data-category-count]").forEach((counter) => {
    counter.textContent = summary.categories[counter.dataset.categoryCount] || 0;
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
  const changedConversation = state.selectedId !== id;
  state.selectedId = id;
  if (changedConversation) {
    state.selectedHeaderSignature = "";
    state.selectedMessagesSignature = "";
    state.selectedNotesSignature = "";
    state.selectedMessageItems = [];
  }
  if (markRead) await api(`/api/conversations/${id}/read`, { method:"POST" });
  const c = await api(`/api/conversations/${id}`);
  const headerSignature = JSON.stringify({
    id: c.id,
    status: c.status,
    categoryId: c.categoryId,
    category: c.category && [c.category.id, c.category.name, c.category.color, c.category.active],
    assignedUserId: c.assignedUserId,
    assignedUser: c.assignedUser && [c.assignedUser.id, c.assignedUser.name],
    contact: [c.contact.id, c.contact.name, c.contact.phone],
  });
  const messageItems = c.messages.map((message) => JSON.stringify([message.id, message.direction, message.type, message.text, message.occurredAt, message.mediaStorageKey, message.mediaMimeType, message.sentByUser?.id, message.sentByUser?.name]));
  const messagesSignature = JSON.stringify(messageItems);
  const notesSignature = JSON.stringify((c.contact.notes || []).map((note) => [note.id, note.content, note.createdAt, note.updatedAt, note.author?.name]));
  state.selectedContactId = c.contact.id;
  $("#empty-state").hidden = true; $("#chat-content").hidden = false; $("#chat-panel").classList.add("open");
  if (headerSignature !== state.selectedHeaderSignature) {
    state.selectedHeaderSignature = headerSignature;
    const name = c.contact.name || c.contact.phone;
    $("#contact-avatar").textContent = initials(name); $("#contact-name").textContent = name; $("#contact-phone").textContent = `+${c.contact.phone}`;
    if (c.categoryId && ![...$("#category-select").options].some((option) => option.value === c.categoryId)) {
      $("#category-select").add(new Option(`${c.category?.name || "Categoria"} (inativa)`, c.categoryId, false, false));
    }
    $("#category-select").value = c.categoryId || "";
    $("#status-badge").className = "status-badge"; $("#status-badge").textContent = statusLabel(c.status);
    $("#assignee-select").value = c.assignedUserId || "";
    $("#claim-conversation").hidden = c.assignedUserId === state.currentUser?.id;
    $("#toggle-finalized").textContent = c.status === "FINALIZADO" ? "Reabrir" : "Finalizar"; $("#toggle-finalized").dataset.status = c.status;
  }
  if (messagesSignature !== state.selectedMessagesSignature) {
    state.selectedMessagesSignature = messagesSignature;
    const canAppend = !changedConversation && state.selectedMessageItems.length <= messageItems.length
      && state.selectedMessageItems.every((item, index) => item === messageItems[index]);
    if (canAppend) {
      $("#messages").insertAdjacentHTML("beforeend", c.messages.slice(state.selectedMessageItems.length).map(messageRowMarkup).join(""));
    } else {
      $("#messages").innerHTML = c.messages.map(messageRowMarkup).join("");
    }
    state.selectedMessageItems = messageItems;
    $("#messages").scrollTop = $("#messages").scrollHeight;
  }
  if (notesSignature !== state.selectedNotesSignature) {
    state.selectedNotesSignature = notesSignature;
    renderNotes(c.contact.notes || []);
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
  $("#notes-list").innerHTML = notes.length ? notes.map((note) => `<article class="note"><p>${escapeHtml(note.content)}</p><footer>${escapeHtml(note.author?.name || "Equipe")} • ${new Intl.DateTimeFormat("pt-BR", { dateStyle:"short", timeStyle:"short" }).format(new Date(note.createdAt))}</footer></article>`).join("") : `<div class="notes-empty">Nenhuma nota adicionada.</div>`;
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
$("#theme-toggle").addEventListener("click", () => {
  const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem("mibro-theme", theme); } catch {}
  syncThemeToggle();
});
$("#user-button").addEventListener("click", async () => { await api("/api/auth/logout", { method:"POST" }); location.replace("/login.html"); });
$("#notes-toggle").addEventListener("click", () => $("#notes-panel").classList.toggle("open"));
$("#notes-close").addEventListener("click", () => $("#notes-panel").classList.remove("open"));
$("#note-form").addEventListener("submit", async (event) => { event.preventDefault(); const input = $("#note-input"); const content = input.value.trim(); if (!content) return; try { await api(`/api/contacts/${state.selectedContactId}/notes`, { method:"POST", body:JSON.stringify({ content }) }); input.value = ""; toast("Nota adicionada ao contato."); await openConversation(state.selectedId); $("#notes-panel").classList.add("open"); } catch (e) { toast(e.message, true); } });
$("#category-select").addEventListener("change", async (event) => { try { await api(`/api/conversations/${state.selectedId}`, { method:"PATCH", body:JSON.stringify({ categoryId:event.target.value || null }) }); toast("Categoria atualizada."); await openConversation(state.selectedId); } catch (e) { toast(e.message, true); } });
$("#assignee-select").addEventListener("change", async (event) => { try { await api(`/api/conversations/${state.selectedId}`, { method:"PATCH", body:JSON.stringify({ assignedUserId:event.target.value || null }) }); toast(event.target.value ? "Responsável atualizado." : "Conversa sem responsável."); await openConversation(state.selectedId); } catch (e) { toast(e.message, true); } });
$("#claim-conversation").addEventListener("click", async () => { try { await api(`/api/conversations/${state.selectedId}/claim`, { method:"POST" }); toast("Conversa atribuída a você."); await openConversation(state.selectedId); } catch (e) { toast(e.message, true); } });
$("#manage-categories").addEventListener("click", () => { renderCategoryManager(); $("#category-dialog").showModal(); });
$("#close-categories").addEventListener("click", () => $("#category-dialog").close());
$("#category-dialog").addEventListener("click", (event) => { if (event.target === $("#category-dialog")) $("#category-dialog").close(); });
$("#category-form").addEventListener("submit", async (event) => { event.preventDefault(); const name = $("#category-name").value.trim(); const color = $("#category-color").value; try { await api("/api/categories", { method:"POST", body:JSON.stringify({ name, color }) }); $("#category-name").value = ""; await loadCategories(); await loadConversations(); toast("Categoria criada."); } catch (e) { toast(e.message, true); } });
$("#category-manager-list").addEventListener("submit", async (event) => { event.preventDefault(); const row = event.target.closest("[data-category-id]"); const name = row.querySelector(".managed-name").value.trim(); const color = row.querySelector(".managed-color").value; const active = row.querySelector(".managed-active").checked; try { await api(`/api/categories/${row.dataset.categoryId}`, { method:"PATCH", body:JSON.stringify({ name, color, active }) }); await loadCategories(); await loadConversations(); toast("Categoria atualizada."); } catch (e) { toast(e.message, true); } });
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
Promise.all([loadCurrentUser(), loadUsers(), loadCategories()])
  .then(loadConversations)
  .then(connectRealtime)
  .catch((error) => toast(error.message, true));
setInterval(() => { if (!document.hidden) refreshInbox().catch(() => {}); }, 30000);
