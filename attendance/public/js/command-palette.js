// Command palette (Ctrl+K): script isolado, carregado depois de app.js.
// Não define seu próprio "state" — lê os dados já carregados pelo app.js
// (state.conversations, state.currentUser) e chama funções globais dele
// (openConversation, toast, openOutboundConversation, escapeHtml, initials,
// messagePreview, categoryLabel). A pesquisa de mensagens consulta a API
// com o escopo de leitura do usuário, além dos contatos já carregados.
(() => {
  const dialogMarkup = `
    <dialog id="command-palette-dialog" class="command-palette-dialog" aria-label="Busca e ações rápidas">
      <div class="cmdk-search">
        <span aria-hidden="true">⌕</span>
        <input id="cmdk-input" type="text" placeholder="Buscar conversas ou executar uma ação..." autocomplete="off" spellcheck="false">
        <kbd>Esc</kbd>
      </div>
      <div id="cmdk-results" class="cmdk-results" role="listbox"></div>
    </dialog>`;
  document.body.insertAdjacentHTML("beforeend", dialogMarkup);

  const dialog = document.getElementById("command-palette-dialog");
  const input = document.getElementById("cmdk-input");
  const results = document.getElementById("cmdk-results");
  let activeIndex = 0;
  let currentItems = [];
  let remoteItems = [];
  let searchTimer;
  let searchRequest;
  let searchSequence = 0;
  let searchPending = false;
  let searchError = "";

  async function searchHistory(term, sequence) {
    searchRequest = new AbortController();
    try {
      // Busca limitada ao workspace (empresa) ativo.
      const company = typeof companyQuery === "function" ? companyQuery() : "";
      const response = await fetch(`/api/conversations/search?q=${encodeURIComponent(term)}${company ? `&company=${encodeURIComponent(company)}` : ""}`, { signal: searchRequest.signal });
      if (!response.ok) throw new Error("Não foi possível pesquisar o histórico. Tente novamente.");
      const rows = await response.json();
      if (sequence !== searchSequence || !dialog.open) return;
      remoteItems = rows.map((row) => ({
        id: `conversation-${row.id}`, label: row.name, icon: "💬",
        meta: row.excerpt || row.phone || row.channel,
        run: async () => {
          if (typeof openConversation !== "function") return;
          await openConversation(row.id);
          if (row.messageId) document.querySelector(`[data-message-id="${CSS.escape(row.messageId)}"]`)?.scrollIntoView({ block: "center" });
        },
      }));
    } catch (error) {
      if (error.name === "AbortError" || sequence !== searchSequence) return;
      searchError = error.message;
    } finally {
      if (sequence === searchSequence) { searchPending = false; render(input.value); }
    }
  }

  function scheduleSearch() {
    clearTimeout(searchTimer);
    searchRequest?.abort();
    const sequence = ++searchSequence;
    remoteItems = [];
    searchError = "";
    const term = input.value.trim().slice(0, 120);
    searchPending = term.length >= 2;
    render(input.value);
    if (searchPending) searchTimer = setTimeout(() => searchHistory(term, sequence), 250);
  }

  const safeText = (value) => (typeof escapeHtml === "function" ? escapeHtml(value) : String(value ?? ""));

  function navigationCommands() {
    const user = typeof state !== "undefined" ? state.currentUser : null;
    if (!user) return [];
    const all = [
      { id: "nav-bots", label: "Abrir Bots", icon: "🤖", enabled: user.isMaster, run: () => { location.href = "/bots"; } },
      { id: "nav-quick-replies", label: "Abrir Respostas rápidas", icon: "⚡", enabled: user.isMaster, run: () => { location.href = "/quick-replies"; } },
      { id: "nav-knowledge", label: "Abrir Base de conhecimento", icon: "📚", enabled: user.isMaster, run: () => { location.href = "/knowledge-base"; } },
      { id: "nav-integrations", label: "Abrir Integrações", icon: "🔌", enabled: user.isMaster, run: () => { location.href = "/integrations"; } },
      { id: "nav-campaigns", label: "Abrir Campanhas", icon: "📣", enabled: user.canManageCampaigns, run: () => { location.href = "/campaigns"; } },
      { id: "nav-settings", label: "Abrir Configurações", icon: "⚙", enabled: user.isMaster || user.role === "SUPERVISOR", run: () => { location.href = "/configuracoes"; } },
      { id: "nav-team", label: "Abrir Equipe", icon: "👥", enabled: user.isMaster, run: () => document.getElementById("team-button")?.click() },
    ];
    return all.filter((item) => item.enabled);
  }

  function actionCommands() {
    const actions = [
      { id: "action-new-conversation", label: "Nova conversa", icon: "＋", run: () => document.getElementById("new-conversation")?.click() },
      { id: "action-theme", label: "Alternar tema claro/escuro", icon: "☾", run: () => document.getElementById("theme-toggle")?.click() },
      { id: "action-search", label: "Focar busca de conversas", icon: "⌕", run: () => document.getElementById("search")?.focus() },
      { id: "action-refresh", label: "Atualizar lista de conversas", icon: "↻", run: () => document.getElementById("refresh")?.click() },
    ];
    if (typeof state !== "undefined" && state.selectedId) {
      actions.push({ id: "action-quick-replies", label: "Abrir respostas rápidas desta conversa", icon: "⚡", run: () => document.getElementById("open-quick-replies")?.click() });
      actions.push({ id: "action-details", label: "Abrir aba Detalhes", icon: "ℹ", run: () => document.querySelector("[data-context-tab='details']")?.click() });
      actions.push({ id: "action-notes", label: "Abrir aba Notas", icon: "🗒", run: () => document.querySelector("[data-context-tab='notes']")?.click() });
    }
    return actions;
  }

  function conversationCommands(term) {
    if (!term || typeof state === "undefined" || !Array.isArray(state.conversations)) return [];
    const query = term.toLocaleLowerCase("pt-BR");
    return state.conversations
      .filter((conversation) => {
        const name = conversation.contact.customName || conversation.contact.name || "";
        const haystack = `${name} ${conversation.contact.phone || ""}`.toLocaleLowerCase("pt-BR");
        return haystack.includes(query);
      })
      .slice(0, 8)
      .map((conversation) => {
        const name = conversation.contact.customName || conversation.contact.name || conversation.contact.phone;
        return {
          id: `conversation-${conversation.id}`,
          label: name,
          // Multiempresa (item 38): o mesmo cliente pode existir nas duas
          // empresas — a empresa aparece no resultado para diferenciar.
          meta: [conversation.company?.displayName, conversation.contact.phone].filter(Boolean).join(" · "),
          icon: "💬",
          run: () => { if (typeof openConversation === "function") openConversation(conversation.id).catch(() => {}); },
        };
      });
  }

  function buildItems(term) {
    const trimmed = term.trim();
    const convos = [...remoteItems, ...conversationCommands(trimmed).filter((item) => !remoteItems.some((remote) => remote.id === item.id))];
    if (!trimmed) return [...actionCommands(), ...navigationCommands()];
    const query = trimmed.toLocaleLowerCase("pt-BR");
    const matches = (label) => label.toLocaleLowerCase("pt-BR").includes(query);
    return [
      ...convos,
      ...actionCommands().filter((item) => matches(item.label)),
      ...navigationCommands().filter((item) => matches(item.label)),
    ];
  }

  function render(term) {
    currentItems = buildItems(term);
    activeIndex = 0;
    if (!currentItems.length) {
      results.innerHTML = `<div class="cmdk-empty">${searchPending ? "Buscando nas mensagens…" : searchError ? safeText(searchError) : `Nenhum resultado para "${safeText(term)}".`}</div>`;
      return;
    }
    results.innerHTML = currentItems.map((item, index) => `
      <button type="button" class="cmdk-item ${index === activeIndex ? "active" : ""}" data-cmdk-index="${index}" role="option">
        <span aria-hidden="true">${item.icon || "›"}</span>
        <span>${safeText(item.label)}</span>
        ${item.meta ? `<small>${safeText(item.meta)}</small>` : ""}
      </button>`).join("");
  }

  function highlight(delta) {
    if (!currentItems.length) return;
    activeIndex = (activeIndex + delta + currentItems.length) % currentItems.length;
    [...results.querySelectorAll(".cmdk-item")].forEach((el, index) => el.classList.toggle("active", index === activeIndex));
    results.querySelector(".cmdk-item.active")?.scrollIntoView({ block: "nearest" });
  }

  function runActive() {
    const item = currentItems[activeIndex];
    if (!item) return;
    close();
    Promise.resolve(item.run()).catch((error) => { if (typeof toast === "function") toast(error.message, true); });
  }

  function open() {
    if (typeof dialog.showModal === "function") dialog.showModal();
    input.value = "";
    remoteItems = [];
    searchPending = false;
    searchError = "";
    render("");
    setTimeout(() => input.focus(), 0);
  }
  function close() { clearTimeout(searchTimer); searchRequest?.abort(); ++searchSequence; if (dialog.open) dialog.close(); }

  document.getElementById("command-palette-trigger")?.addEventListener("click", open);
  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === "k") { event.preventDefault(); open(); }
  });
  dialog.addEventListener("click", (event) => { if (event.target === dialog) close(); });
  dialog.addEventListener("cancel", close);
  input.addEventListener("input", scheduleSearch);
  results.addEventListener("click", (event) => {
    const button = event.target.closest("[data-cmdk-index]");
    if (!button) return;
    activeIndex = Number(button.dataset.cmdkIndex);
    runActive();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") { event.preventDefault(); highlight(1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); highlight(-1); }
    else if (event.key === "Enter") { event.preventDefault(); runActive(); }
    else if (event.key === "Escape") { event.preventDefault(); close(); }
  });
})();
