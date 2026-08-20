(() => {
  const state = {
    chats: [],
    currentChatId: null,
    currentUser: null,
    selectedImage: null,
    selectedImageUrl: null,
    openSequence: 0,
  };

  const $ = (selector) => document.querySelector(selector);

  const escapeHtml = (value = "") =>
    String(value).replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    })[char]);


  async function api(url, options = {}) {
  const isFormData = options.body instanceof FormData;

  const headers = {
    ...(options.headers || {}),
  };

  if (!isFormData) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      body.error || "Erro no chat interno."
    );
  }

  return response.json();
}

  function formatTime(value) {
    if (!value) return "";

    return new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
    }).format(new Date(value));
  }

  function chatDisplayName(chat) {
    if (chat.type !== "DIRECT") {
      return chat.name || "Chat interno";
    }

    const other = chat.members?.find(
      (user) => user.id !== state.currentUser?.id
    );

    return other?.name || "Conversa direta";
  }

  function chatIcon(chat) {
    if (chat.type === "GENERAL") return "#";
    if (chat.type === "SECTOR") return "#";
    return "●";
  }

  function renderChatList() {
    const container = $("#internal-chat-list");
    if (!container) return;

    if (!state.chats.length) {
      container.innerHTML =
        '<div class="internal-chat-empty-list">Nenhum chat disponível.</div>';
      return;
    }

    container.innerHTML = state.chats.map((chat) => {
      const active = chat.id === state.currentChatId;
      const preview = chat.lastMessage?.text
        || (
          chat.lastMessage?.type === "TRANSFER"
            ? "Nova transferência"
            : "Sem mensagens"
        );

      return `
        <button
          type="button"
          class="internal-chat-item ${active ? "active" : ""}"
          data-chat-id="${escapeHtml(chat.id)}"
        >
          <span class="internal-chat-item-icon">
            ${escapeHtml(chatIcon(chat))}
          </span>

          <span class="internal-chat-item-content">
            <strong>${escapeHtml(chatDisplayName(chat))}</strong>
            <small>${escapeHtml(preview)}</small>
          </span>

          ${
            chat.unreadCount
              ? `<b>${chat.unreadCount}</b>`
              : ""
          }
        </button>
      `;
    }).join("");

    container.querySelectorAll("[data-chat-id]").forEach((button) => {
      button.addEventListener("click", () => {
        openChat(button.dataset.chatId);
      });
    });
  }

  function syncGlobalUnread() {
    const count = state.chats.reduce(
      (total, chat) => total + Number(chat.unreadCount || 0),
      0
    );

    const badge = $("#internal-chat-unread");

    if (!badge) return;

    badge.textContent = count > 99 ? "99+" : String(count);
    badge.hidden = count === 0;
  }

  async function loadChats() {
    state.chats = await api("/api/internal-chats");

    renderChatList();
    syncGlobalUnread();
  }

  function renderTransferMessage(message) {
  const meta = message.metadata || {};

  const actor =
    meta.actorName ||
    message.senderUser?.name ||
    "Alguém";

  const destination =
    meta.toCategory ||
    "outro setor";

  return `
    <div class="internal-transfer-line">
      <span>↪</span>
      <p>
        <strong>${escapeHtml(actor)}</strong>
        sinalizou envio para
        <strong>${escapeHtml(destination)}</strong>
      </p>
      <small>${escapeHtml(formatTime(message.createdAt))}</small>
    </div>
  `;
}

  function renderMessages(messages, { forceScroll = false } = {}) {
    const container = $("#internal-chat-messages");
    if (!container) return;

    const wasNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < 80;

    if (!messages.length) {
      container.innerHTML =
        '<div class="internal-chat-empty">Nenhuma mensagem neste chat.</div>';
      return;
    }

    container.innerHTML = messages.map((message) => {
      if (message.type === "TRANSFER") {
        return renderTransferMessage(message);
      }

      const own = message.senderUserId === state.currentUser?.id;

      const media = message.metadata?.media;

const image = media?.storageKey
  ? `
      <a
        href="/api/internal-messages/${encodeURIComponent(message.id)}/media"
        target="_blank"
        rel="noopener"
        class="internal-message-image-link"
      >
        <img
          class="internal-message-image"
          src="/api/internal-messages/${encodeURIComponent(message.id)}/media"
          alt="${escapeHtml(media.fileName || "Imagem")}"
          loading="lazy"
        >
      </a>
    `
  : "";

      return `
        <div class="internal-message-row ${own ? "own" : ""}">
          <div class="internal-message-bubble">
  <strong>${escapeHtml(message.senderUser?.name || "Sistema")}</strong>
  ${image}
  ${
    message.text
      ? `<p>${escapeHtml(message.text)}</p>`
      : ""
  }
  <small>${formatTime(message.createdAt)}</small>
</div>
        </div>
      `;
    }).join("");

    if (forceScroll || wasNearBottom) {
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
      });
    }
  }

  async function openChat(chatId) {
    const chat = state.chats.find((item) => item.id === chatId);
    if (!chat) return;

    state.currentChatId = chatId;
    const sequence = ++state.openSequence;

    $("#internal-chat-title").textContent = chatDisplayName(chat);

    $("#internal-chat-type").textContent = {
      GENERAL: "CHAT GERAL",
      SECTOR: "CHAT DO SETOR",
      DIRECT: "MENSAGEM DIRETA",
    }[chat.type] || "CHAT INTERNO";

    $("#internal-chat-input").disabled = false;
    $("#internal-chat-send").disabled = false;

    renderChatList();

    const messages = await api(
      `/api/internal-chats/${encodeURIComponent(chatId)}/messages`
    );

    if (sequence !== state.openSequence || state.currentChatId !== chatId) return;

    renderMessages(messages, { forceScroll: true });

    await api(
      `/api/internal-chats/${encodeURIComponent(chatId)}/read`,
      { method: "POST" }
    );

    if (sequence === state.openSequence) await loadChats();
  }

  async function loadUsers() {
    if (!state.currentUser) return;

    const select = $("#internal-chat-user-select");
    if (!select) return;

    let users = [];

    try {
      const response = await fetch("/api/internal-chat-users");
      if (response.ok) users = await response.json();
    } catch {}

    if (!Array.isArray(users)) return;

    select.innerHTML =
      '<option value="">Selecionar usuário</option>' +
      users
        .filter(
          (user) =>
            user.active !== false &&
            user.id !== state.currentUser.id
        )
        .map(
          (user) =>
            `<option value="${escapeHtml(user.id)}">${escapeHtml(user.name)}</option>`
        )
        .join("");
  }

  async function openDialog() {
    const dialog = $("#internal-chat-dialog");

    if (!dialog.open) dialog.showModal();

    await loadChats();

    const selected = state.chats.find(
      (chat) => chat.id === state.currentChatId
    );
    const initial = selected
      || state.chats.find((chat) => chat.type === "GENERAL")
      || state.chats[0];

    if (initial) await openChat(initial.id);
  }

  async function detectCurrentUser() {
    try {
      const response = await fetch("/api/auth/status");
      if (!response.ok) return;

      const data = await response.json();
      state.currentUser = data.user || null;

      await loadUsers();
    } catch {}
  }

  $("#internal-chat-button")?.addEventListener(
    "click",
    () => openDialog().catch(console.error)
  );

  $("#close-internal-chat")?.addEventListener(
    "click",
    () => $("#internal-chat-dialog")?.close()
  );

  $("#internal-chat-dialog")?.addEventListener(
    "click",
    (event) => {
      if (event.target === $("#internal-chat-dialog")) {
        $("#internal-chat-dialog").close();
      }
    }
  );

    $("#internal-chat-input")?.addEventListener("keydown", (event) => {
  if (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.isComposing
  ) {
    event.preventDefault();

    $("#internal-chat-form")?.requestSubmit();
  }
});

function clearInternalImage() {
  state.selectedImage = null;

  if (state.selectedImageUrl) {
    URL.revokeObjectURL(state.selectedImageUrl);
    state.selectedImageUrl = null;
  }

  const preview = $("#internal-chat-image-preview");
  const thumb = $("#internal-chat-image-thumb");

  if (preview) preview.hidden = true;

  if (thumb) {
    thumb.removeAttribute("src");
  }
}

function selectInternalImage(file) {
  if (!file) return;

  if (
    !["image/jpeg", "image/png"].includes(file.type)
  ) {
    alert("Cole uma imagem JPG ou PNG.");
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    alert("A imagem deve ter no máximo 5 MB.");
    return;
  }

  clearInternalImage();

  state.selectedImage = file;
  state.selectedImageUrl = URL.createObjectURL(file);

  $("#internal-chat-image-thumb").src =
    state.selectedImageUrl;

  $("#internal-chat-image-preview").hidden = false;
}

$("#internal-chat-input")?.addEventListener(
  "paste",
  (event) => {
    const items = Array.from(
      event.clipboardData?.items || []
    );

    const imageItem = items.find(
      (item) =>
        item.kind === "file" &&
        ["image/png", "image/jpeg"].includes(
          item.type
        )
    );

    if (!imageItem) return;

    const file = imageItem.getAsFile();
    if (!file) return;

    event.preventDefault();

    const extension =
      file.type === "image/jpeg"
        ? "jpg"
        : "png";

    selectInternalImage(
      new File(
        [file],
        `imagem-colada-${Date.now()}.${extension}`,
        {
          type: file.type,
        }
      )
    );
  }
);
$("#internal-chat-remove-image")?.addEventListener(
  "click",
  clearInternalImage
);
  $("#internal-chat-form")?.addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();

      if (!state.currentChatId) return;

      const input = $("#internal-chat-input");
      const text = input.value.trim();

if (!text && !state.selectedImage) return;

      $("#internal-chat-send").disabled = true;

      try {
         if (state.selectedImage) {
  const form = new FormData();

  form.append("image", state.selectedImage);

  if (text) {
    form.append("caption", text);
  }

  await api(
    `/api/internal-chats/${encodeURIComponent(state.currentChatId)}/images`,
    {
      method: "POST",
      body: form,
    }
  );

  clearInternalImage();
} else {
  await api(
    `/api/internal-chats/${encodeURIComponent(state.currentChatId)}/messages`,
    {
      method: "POST",
      body: JSON.stringify({ text }),
    }
  );
}

        input.value = "";

        await openChat(state.currentChatId);
      } finally {
        $("#internal-chat-send").disabled = false;
        input.focus();
      }
    }
  );

  $("#open-direct-chat")?.addEventListener(
    "click",
    async () => {
      const userId = $("#internal-chat-user-select")?.value;
      if (!userId) return;

      const chat = await api(
        `/api/internal-chats/direct/${encodeURIComponent(userId)}`,
        {
          method: "POST",
        }
      );

      await loadChats();
      await openChat(chat.id);
    }
  );

  let internalNotificationReady = false;

  document.addEventListener("DOMContentLoaded", async () => {
    await detectCurrentUser();

    try {
      await loadChats();
      internalNotificationReady = true;
    } catch {}
  });

  const events = new EventSource("/api/events");
  const notifiedInternalMessages = new Set();
  let realtimeRefreshTimer;
  let realtimeRefreshRunning = false;
  let realtimeRefreshPending = false;

  function rememberNotification(messageId) {
    notifiedInternalMessages.add(messageId);

    if (notifiedInternalMessages.size > 200) {
      const oldest = notifiedInternalMessages.values().next().value;
      notifiedInternalMessages.delete(oldest);
    }
  }

  async function refreshInternalChat() {
    if (realtimeRefreshRunning) {
      realtimeRefreshPending = true;
      return;
    }

    realtimeRefreshRunning = true;

    try {
      const previousLastMessages = new Map(
        state.chats.map((chat) => [chat.id, chat.lastMessage?.id || null])
      );

      await loadChats();

      if (internalNotificationReady) {
        for (const chat of state.chats) {
          const message = chat.lastMessage;

          if (!message?.id) continue;
          if (previousLastMessages.get(chat.id) === message.id) continue;
          if (notifiedInternalMessages.has(message.id)) continue;
          if (message.senderUserId === state.currentUser?.id) continue;
          if (message.type !== "USER") continue;

          rememberNotification(message.id);

          if (document.hidden && typeof window.mibroNotify === "function") {
            await window.mibroNotify(
              `${message.senderUser?.name || "Alguém da equipe"} mandou uma mensagem`,
              {
                tag: `internal:${message.id}`,
                data: { url: "/" },
              }
            );
          }
        }
      }

      internalNotificationReady = true;

      const chatId = state.currentChatId;
      if (chatId && $("#internal-chat-dialog")?.open) {
        const messages = await api(
          `/api/internal-chats/${encodeURIComponent(chatId)}/messages`
        );

        if (state.currentChatId === chatId) {
          renderMessages(messages);
          await api(
            `/api/internal-chats/${encodeURIComponent(chatId)}/read`,
            { method: "POST" }
          );
          await loadChats();
        }
      }
    } catch (error) {
      console.warn(
        "Não foi possível atualizar o chat interno em tempo real.",
        error
      );
    } finally {
      realtimeRefreshRunning = false;

      if (realtimeRefreshPending) {
        realtimeRefreshPending = false;
        scheduleRealtimeRefresh();
      }
    }
  }

  function scheduleRealtimeRefresh() {
    clearTimeout(realtimeRefreshTimer);
    realtimeRefreshTimer = setTimeout(refreshInternalChat, 120);
  }

  events.addEventListener("inbox.updated", scheduleRealtimeRefresh);
  window.addEventListener("beforeunload", () => events.close(), { once: true });
})();
