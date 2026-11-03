// Perfil 360° do cliente (diálogo aberto pela aba Detalhes). Só leitura;
// tudo vem já filtrado do backend (contact-profile-service): conversas do
// escopo, eventos permitidos, Financeiro protegido, sem mensagens.
(function contactProfileUi() {
  const $ = (selector) => document.querySelector(selector);
  const esc = (value = "") => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  const TIME_ZONE = "America/Sao_Paulo";
  const when = (date) => (date ? new Intl.DateTimeFormat("pt-BR", { timeZone: TIME_ZONE, dateStyle: "short", timeStyle: "short" }).format(new Date(date)) : "—");
  const STATE_LABELS = { PENDENTE: "Pendente", ATRASADO: "Atrasado", CONCLUIDO: "Concluído", CANCELADO: "Cancelado" };
  const ui = { contactId: null, cursor: null, loading: false };

  async function api(url) {
    const response = await fetch(url, { credentials: "same-origin" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(body?.error || "Não foi possível carregar o perfil."), { status: response.status });
    return body;
  }

  const row = (label, value) => `<div class="cp-row"><span>${esc(label)}</span><strong>${value}</strong></div>`;

  function render(profile) {
    const company = profile.company;
    const badge = company ? `<span class="company-badge" style="--company-color:${esc(company.primaryColor)}">${esc(company.displayName)}</span>` : "";
    $("#contact-profile-title").innerHTML = `${esc(profile.contact.name)} ${badge}`;
    $("#contact-profile-subtitle").textContent = [profile.contact.phone ? `+${profile.contact.phone}` : null, profile.contact.email].filter(Boolean).join(" · ");
    const current = profile.current;
    const stats = profile.stats;
    $("#contact-profile-body").innerHTML = `
      <section class="cp-section"><h3>Visão geral</h3><div class="cp-rows">
        ${row("Empresa", esc(company?.name || "—"))}
        ${current?.channelAccount ? row("Número/canal", esc(`${current.channelAccount.name}${current.channelAccount.displayNumber ? ` · ${current.channelAccount.displayNumber}` : ""}`)) : ""}
        ${row("Atendente fixo", profile.preferredAssignee ? `★ ${esc(profile.preferredAssignee.name)}${profile.preferredAssignee.autoRouteEnabled ? "" : " (direcionamento desligado)"}` : "Nenhum")}
        ${row("Responsável atual", esc(current?.assignee?.name || "Sem responsável"))}
        ${row("Setor", esc(current?.category || "Sem categoria"))}
        ${row("Status", esc(current?.statusLabel || "—"))}
        ${row("Primeiro contato", esc(when(stats.firstContactAt)))}
        ${row("Última interação", esc(when(stats.lastInteractionAt)))}
        ${row("Atendimentos finalizados", stats.finalizedCycles === null ? "<small>sem permissão de histórico</small>" : esc(String(stats.finalizedCycles)))}
        ${row("Transferências", stats.transfers === null ? "<small>sem permissão de histórico</small>" : esc(String(stats.transfers)))}
        ${profile.contact.mergedContacts ? row("Contatos fundidos", esc(String(profile.contact.mergedContacts))) : ""}
      </div></section>
      <section class="cp-section"><h3>Agenda <small>${profile.agenda.pending} pendente(s)${profile.agenda.overdue ? ` · <b class="cp-alert">${profile.agenda.overdue} atrasado(s)</b>` : ""}</small></h3>
        ${profile.agenda.items.length ? `<ul class="cp-list">${profile.agenda.items.map((item) => `<li><b>${esc(when(item.dueAt))}</b> · ${esc(item.reasonLabel)} · <span class="cp-state ${esc(item.state)}">${esc(STATE_LABELS[item.state] || item.state)}</span>${item.assignee ? ` · ${esc(item.assignee.name)}` : ""}${item.restricted ? " · 🔒" : ""}</li>`).join("")}</ul>` : `<p class="cp-empty">Nenhum retorno agendado.</p>`}
      </section>
      <section class="cp-section"><h3>Observações</h3>
        ${profile.notes.length ? `<ul class="cp-list">${profile.notes.map((note) => `<li>${note.pinned ? "📌 " : ""}${esc(note.content)}<small>${esc(note.author)} · ${esc(when(note.updatedAt))}</small></li>`).join("")}</ul>` : `<p class="cp-empty">Nenhuma nota visível.</p>`}
      </section>
      <section class="cp-section"><h3>Informações comerciais</h3><div class="cp-rows">
        ${window.CrmContext?.available?.() ? '<button type="button" id="profile-send-crm" class="cp-more">Cadastrar / vincular ao CRM</button>' : ''}
        ${row("Origem", esc(profile.commercial.origin || "Não registrada"))}
        ${row("Setores atendidos", esc(profile.commercial.sectors.join(", ") || "—"))}
        ${row("Pedidos / faturamento", "<small>Sem integração — não exibido</small>")}
      </div></section>
      <section class="cp-section"><h3>Conversas (${profile.conversations.length})</h3>
        <ul class="cp-list">${profile.conversations.map((conversation) => `<li><b>${esc(conversation.channelAccount?.name || conversation.channelLabel || conversation.channel)}</b> · ${esc(conversation.statusLabel)}${conversation.category ? ` · ${esc(conversation.category)}` : ""}${conversation.assignee ? ` · ${esc(conversation.assignee.name)}` : ""}<small>Última interação: ${esc(when(conversation.lastMessageAt))}</small></li>`).join("")}</ul>
      </section>
      ${profile.canViewHistory ? `<section class="cp-section"><h3>Linha do tempo</h3>
        <ol id="contact-profile-timeline" class="cp-timeline"></ol>
        <button id="contact-profile-more" type="button" class="cp-more" hidden>Carregar eventos anteriores</button>
      </section>` : ""}`;
    $("#contact-profile-more")?.addEventListener("click", loadTimeline);
    $('#profile-send-crm')?.addEventListener('click',()=>{$('#contact-profile-dialog').close();window.CrmContext?.openImport();});
  }

  async function loadTimeline() {
    if (ui.loading || !ui.contactId || !$("#contact-profile-timeline")) return;
    ui.loading = true;
    try {
      const params = new URLSearchParams({ limit: "30" });
      if (ui.cursor) params.set("before", ui.cursor);
      const page = await api(`/api/contacts/${encodeURIComponent(ui.contactId)}/timeline?${params}`);
      const list = $("#contact-profile-timeline");
      if (!list) return;
      list.insertAdjacentHTML("beforeend", page.items.map((item) => `<li class="${item.restricted ? "restricted" : ""}"><time>${esc(when(item.at))}</time><span>${esc(item.label)}${item.restricted ? " 🔒" : ""}</span>${item.channel ? `<small>${esc(item.channel)}</small>` : ""}</li>`).join(""));
      if (!list.children.length) list.innerHTML = `<li class="cp-empty">Sem eventos visíveis.</li>`;
      ui.cursor = page.nextCursor;
      $("#contact-profile-more").hidden = !page.nextCursor;
    } catch (error) {
      $("#contact-profile-timeline")?.insertAdjacentHTML("beforeend", `<li class="cp-empty">${esc(error.message)}</li>`);
    } finally {
      ui.loading = false;
    }
  }

  async function open(contactId) {
    if (!contactId) return;
    ui.contactId = contactId;
    ui.cursor = null;
    $("#contact-profile-body").innerHTML = `<p class="cp-empty">Carregando…</p>`;
    $("#contact-profile-dialog").showModal();
    try {
      const profile = await api(`/api/contacts/${encodeURIComponent(contactId)}/profile`);
      render(profile);
      if (profile.canViewHistory) await loadTimeline();
    } catch (error) {
      $("#contact-profile-body").innerHTML = `<p class="cp-empty">${esc(error.status === 403 || error.status === 404 ? "Você não tem acesso a este contato." : error.message)}</p>`;
    }
  }

  $("#close-contact-profile")?.addEventListener("click", () => $("#contact-profile-dialog").close());
  window.ContactProfileUI = { open };
})();
