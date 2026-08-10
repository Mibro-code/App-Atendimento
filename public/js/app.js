const state = { conversations: [], categories: [], selectedId: null, selectedContactId: null, status: "", category: "", search: "" };
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[char]);
const initials = (name = "?") => name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
const time = (value) => value ? new Intl.DateTimeFormat("pt-BR", { hour:"2-digit", minute:"2-digit" }).format(new Date(value)) : "";
const statusLabel = (value) => ({ NOVO:"Novo", EM_ATENDIMENTO:"Em atendimento", AGUARDANDO_CLIENTE:"Aguardando cliente", BOT:"Bot", FINALIZADO:"Finalizado" })[value] || value;

async function loadCurrentUser() {
  const status = await api("/api/auth/status");
  if (!status.authenticated) return location.replace("/login.html");
  $("#current-user").textContent = status.user.name;
}

async function api(path, options) {
  const response = await fetch(path, { headers: { "Content-Type":"application/json" }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir a operação.");
  return data;
}
function toast(message, error = false) { const el = $("#toast"); el.textContent = message; el.className = `toast show${error ? " error" : ""}`; setTimeout(() => el.className = "toast", 2600); }

async function loadCategories() {
  state.categories = await api("/api/categories");
  $("#category-filters").innerHTML = state.categories.filter((c) => c.active).map((c) => `<button class="filter" data-category="${c.code}"><span><i class="category-dot" style="background:${c.color || "#999"}"></i>${escapeHtml(c.name)}</span><strong data-category-count="${c.id}">0</strong></button>`).join("");
  $("#category-select").innerHTML = `<option value="">Sem categoria</option>` + state.categories.filter((c) => c.active).map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  document.querySelectorAll("[data-category]").forEach((button) => button.addEventListener("click", () => {
    document.querySelectorAll(".filter").forEach((item) => item.classList.remove("active")); button.classList.add("active"); state.category = button.dataset.category; state.status = ""; loadConversations();
  }));
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
  const list = $("#conversation-list");
  if (!state.conversations.length) { list.innerHTML = `<div class="empty-list">Nenhuma conversa encontrada.</div>`; return; }
  list.innerHTML = state.conversations.map((c) => {
    const last = c.messages[0]; const name = c.contact.name || c.contact.phone; const note = c.contact.notes?.[0];
    return `<button class="conversation-card ${c.id === state.selectedId ? "active" : ""}" data-id="${c.id}">
      <span class="card-grip" aria-hidden="true"></span><span class="avatar">${escapeHtml(initials(name))}</span><span class="card-main">
      <span class="card-title"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(c.contact.phone)}</small></span>
      <span class="preview">${escapeHtml(last?.text || "Conversa sem mensagens")}</span>
      <span class="card-labels"><span class="category-label" style="color:${c.category?.color || "#666"};border-color:${c.category?.color || "#aaa"}">${escapeHtml(c.category?.name || "Sem categoria")}</span><span class="status-label">${escapeHtml(statusLabel(c.status))}</span></span>
      <span class="note-preview"><b>NOTA</b> ${escapeHtml(note?.content || "Sem notas para este contato")}${c.contact._count?.notes ? `<i>${c.contact._count.notes}</i>` : ""}</span></span>
      <span class="card-side"><span>${time(c.lastMessageAt)}</span>${c.unreadCount ? `<span class="unread">${c.unreadCount}</span>` : ""}</span></button>`;
  }).join("");
  document.querySelectorAll(".conversation-card").forEach((card) => card.addEventListener("click", () => openConversation(card.dataset.id)));
}

async function openConversation(id) {
  state.selectedId = id; await api(`/api/conversations/${id}/read`, { method:"POST" });
  const c = await api(`/api/conversations/${id}`);
  state.selectedContactId = c.contact.id;
  $("#empty-state").hidden = true; $("#chat-content").hidden = false; $("#chat-panel").classList.add("open");
  const name = c.contact.name || c.contact.phone;
  $("#contact-avatar").textContent = initials(name); $("#contact-name").textContent = name; $("#contact-phone").textContent = `+${c.contact.phone}`;
  $("#category-select").value = c.categoryId || "";
  $("#status-badge").className = "status-badge"; $("#status-badge").textContent = statusLabel(c.status);
  $("#assignment").textContent = c.assignedUser ? `Responsável: ${c.assignedUser.name}` : "Sem atendente responsável";
  $("#toggle-finalized").textContent = c.status === "FINALIZADO" ? "Reabrir" : "Finalizar"; $("#toggle-finalized").dataset.status = c.status;
  $("#messages").innerHTML = c.messages.map((m) => `<div class="message-row ${m.direction === "ENVIADA" ? "sent" : "received"}"><div class="bubble"><p>${escapeHtml(m.text || `[${m.type}]`)}</p><footer>${m.sentByUser ? `<span class="author">${escapeHtml(m.sentByUser.name)}</span>` : ""}<span>${time(m.occurredAt)}</span></footer></div></div>`).join("");
  renderNotes(c.contact.notes || []);
  $("#messages").scrollTop = $("#messages").scrollHeight; await loadConversations();
}

function renderNotes(notes) {
  $("#notes-list").innerHTML = notes.length ? notes.map((note) => `<article class="note"><p>${escapeHtml(note.content)}</p><footer>${escapeHtml(note.author?.name || "Equipe")} • ${new Intl.DateTimeFormat("pt-BR", { dateStyle:"short", timeStyle:"short" }).format(new Date(note.createdAt))}</footer></article>`).join("") : `<div class="notes-empty">Nenhuma nota adicionada.</div>`;
}

document.querySelectorAll("[data-status]").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".filter").forEach((item) => item.classList.remove("active")); button.classList.add("active"); state.status = button.dataset.status; state.category = ""; loadConversations();
}));
let searchTimer; $("#search").addEventListener("input", (event) => { clearTimeout(searchTimer); state.search = event.target.value.trim(); searchTimer = setTimeout(loadConversations, 250); });
$("#refresh").addEventListener("click", loadConversations);
$("#user-button").addEventListener("click", async () => { await api("/api/auth/logout", { method:"POST" }); location.replace("/login.html"); });
$("#notes-toggle").addEventListener("click", () => $("#notes-panel").classList.toggle("open"));
$("#notes-close").addEventListener("click", () => $("#notes-panel").classList.remove("open"));
$("#note-form").addEventListener("submit", async (event) => { event.preventDefault(); const input = $("#note-input"); const content = input.value.trim(); if (!content) return; try { await api(`/api/contacts/${state.selectedContactId}/notes`, { method:"POST", body:JSON.stringify({ content }) }); input.value = ""; toast("Nota adicionada ao contato."); await openConversation(state.selectedId); $("#notes-panel").classList.add("open"); } catch (e) { toast(e.message, true); } });
$("#category-select").addEventListener("change", async (event) => { try { await api(`/api/conversations/${state.selectedId}`, { method:"PATCH", body:JSON.stringify({ categoryId:event.target.value || null }) }); toast("Categoria atualizada."); await openConversation(state.selectedId); } catch (e) { toast(e.message, true); } });
$("#toggle-finalized").addEventListener("click", async (event) => { const status = event.target.dataset.status === "FINALIZADO" ? "NOVO" : "FINALIZADO"; try { await api(`/api/conversations/${state.selectedId}`, { method:"PATCH", body:JSON.stringify({ status }) }); toast(status === "FINALIZADO" ? "Atendimento finalizado." : "Atendimento reaberto."); await openConversation(state.selectedId); } catch (e) { toast(e.message, true); } });
$("#composer").addEventListener("submit", async (event) => { event.preventDefault(); const input = $("#message-input"); const text = input.value.trim(); if (!text) return; $("#send-button").disabled = true; try { await api(`/api/conversations/${state.selectedId}/messages`, { method:"POST", body:JSON.stringify({ text }) }); input.value = ""; await openConversation(state.selectedId); } catch (e) { toast(e.message, true); } finally { $("#send-button").disabled = false; input.focus(); } });
$("#message-input").addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); $("#composer").requestSubmit(); } });
$(".chat-header").addEventListener("click", (event) => { if (innerWidth <= 700 && event.offsetX < 45) $("#chat-panel").classList.remove("open"); });

Promise.all([loadCurrentUser(), loadCategories(), loadConversations()]).catch((error) => toast(error.message, true));
setInterval(() => { if (!document.hidden) loadConversations().catch(() => {}); }, 5000);
