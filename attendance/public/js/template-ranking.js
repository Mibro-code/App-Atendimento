// Ranking de templates (Custos Meta) — só apresentação. Agregação, regra de
// resposta e isolamento por empresa ficam no backend
// (/api/meta-costs/templates). Reordenar não refaz a consulta.
(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = (value = "") => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  const num = (value) => (Number(value) || 0).toLocaleString("pt-BR");
  const pct = (value) => (value === null || value === undefined ? "—" : `${Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);
  const shortDate = (day) => { const [, m, d] = String(day).split("-"); return `${d}/${m}`; };
  const longDate = (value) => (value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value)) : "—");
  const CATEGORY = { MARKETING: "Marketing", UTILITY: "Utilidade", AUTHENTICATION: "Autenticação" };
  const VISIBLE = 5;
  const SMALL_SAMPLE = 10;
  const STORE = "central-template-ranking";

  const state = { scope: null, period: "30d", from: "", to: "", sort: "sent", expanded: false, report: null, sequence: 0, detailSequence: 0 };
  try { Object.assign(state, JSON.parse(localStorage.getItem(STORE) || "{}") || {}, { expanded: false, report: null, sequence: 0, detailSequence: 0 }); } catch { /* preferências opcionais */ }
  const remember = () => { try { localStorage.setItem(STORE, JSON.stringify({ period: state.period, from: state.from, to: state.to, sort: state.sort })); } catch { /* ignore */ } };

  async function api(url) {
    const response = await fetch(url, { credentials: "same-origin" });
    if (response.status === 401) { location.replace("/login.html"); throw new Error("Sessão encerrada."); }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error || "Não foi possível carregar o ranking.");
    return body;
  }

  function params(extra = {}) {
    const query = new URLSearchParams({ company: state.scope.company, period: state.period });
    if (state.period === "custom") { query.set("from", state.from); query.set("to", state.to); }
    if (state.scope.channelAccountId) query.set("channelAccountId", state.scope.channelAccountId);
    for (const [key, value] of Object.entries(extra)) if (value !== undefined && value !== null) query.set(key, value);
    return query;
  }

  function sorted(templates) {
    const list = [...templates];
    return state.sort === "rate"
      ? list.sort((a, b) => (b.responseRate ?? -1) - (a.responseRate ?? -1) || b.responseEligible - a.responseEligible || b.sent - a.sent)
      : list.sort((a, b) => b.sent - a.sent || b.replied - a.replied || String(a.name).localeCompare(String(b.name)));
  }

  function templateLabel(item) {
    return item.identified ? item.name : "Template sem nome registrado";
  }

  function renderSummary(total) {
    $("#tpl-summary").innerHTML = [
      ["Total enviado", num(total.sent), total.failed ? `${num(total.failed)} falha(s) fora` : ""],
      ["Entregues", num(total.delivered), ""],
      ["Lidas", num(total.read), ""],
      ["Templates respondidos", `${num(total.replied)} / ${num(total.responseEligible)}`, "respondidos / avaliáveis"],
      ["Taxa de resposta", pct(total.responseRate), ""],
      ["Contatos que responderam", `${num(total.contactsReplied)} / ${num(total.contactsReached)}`, "contatos únicos"],
    ].map(([label, value, hint]) => `<div><span>${esc(label)}</span><b>${esc(value)}</b>${hint ? `<span>${esc(hint)}</span>` : ""}</div>`).join("");
  }

  function renderList() {
    const report = state.report;
    if (!report) return;
    const list = sorted(report.templates);
    const visible = state.expanded ? list : list.slice(0, VISIBLE);
    const maxSent = Math.max(1, ...list.map((item) => item.sent));
    $("#tpl-list").innerHTML = visible.length ? visible.map((item, index) => {
      const width = state.sort === "rate" ? (item.responseRate ?? 0) : (item.sent / maxSent) * 100;
      const replied = item.sent ? (item.replied / item.sent) * 100 : 0;
      const meta = [CATEGORY[item.category] || item.category || "Categoria não registrada", item.language || "idioma não registrado", item.numbers > 1 ? `${item.numbers} números` : ""].filter(Boolean).join(" · ");
      const small = item.responseEligible > 0 && item.responseEligible < SMALL_SAMPLE ? `<span class="tpl-small" title="Menos de ${SMALL_SAMPLE} envios avaliáveis: a taxa varia muito.">amostra pequena</span>` : "";
      const label = `${templateLabel(item)}: ${num(item.sent)} enviados, ${num(item.replied)} respondidos, taxa ${pct(item.responseRate)}`;
      return `<button type="button" class="tpl-row" data-index="${report.templates.indexOf(item)}" aria-label="${esc(label)}. Abrir detalhes">
        <span class="tpl-rank">${index + 1}</span>
        <span class="tpl-name"><b title="${esc(templateLabel(item))}">${esc(templateLabel(item))}</b><small>${esc(meta)}</small></span>
        <span class="tpl-bar" aria-hidden="true"><i style="--sent:${width.toFixed(1)}%;--replied:${state.sort === "rate" ? 100 : replied.toFixed(1)}%"></i></span>
        <span class="tpl-stats"><span>Enviados <b>${num(item.sent)}</b></span><span>Entregues <b>${num(item.delivered)}</b></span><span>Lidas <b>${num(item.read)}</b></span><span>Respostas <b>${num(item.replied)}</b></span><span class="tpl-rate"><b>${pct(item.responseRate)}</b> ${small}</span></span>
      </button>`;
    }).join("") : `<div class="ops-empty">Nenhum template enviado por esta empresa no período.</div>`;
    const more = $("#tpl-more");
    more.hidden = list.length <= VISIBLE;
    more.textContent = state.expanded ? "Mostrar só os 5 primeiros" : `Ver todos os ${list.length} templates`;
    more.setAttribute("aria-expanded", String(state.expanded));
  }

  function barRows(steps, max) {
    return steps.map((step) => `<div class="tpl-step"><div class="tpl-step-label"><span>${esc(step.label)}</span><b>${num(step.value)}</b></div><div class="tpl-bar" aria-hidden="true"><i style="--sent:${((step.value / max) * 100).toFixed(1)}%"></i></div>${step.note ? `<small>${esc(step.note)}</small>` : ""}</div>`).join("");
  }

  // Períodos longos viram semanas (agrupadas aqui, sem nova consulta) para
  // as barras não sumirem.
  function buckets(series) {
    if (series.length <= 62) return { unit: "dia", rows: series.map((day) => ({ label: shortDate(day.day), sent: day.sent, replied: day.replied })) };
    const rows = [];
    for (let index = 0; index < series.length; index += 7) {
      const week = series.slice(index, index + 7);
      rows.push({ label: `${shortDate(week[0].day)}–${shortDate(week[week.length - 1].day)}`, sent: week.reduce((sum, day) => sum + day.sent, 0), replied: week.reduce((sum, day) => sum + day.replied, 0) });
    }
    return { unit: "semana", rows };
  }

  function evolution(series) {
    const total = series.reduce((sum, day) => sum + day.sent, 0);
    if (!total) return `<div class="ops-empty">Sem envios de template no período.</div>`;
    const { unit, rows } = buckets(series);
    const max = Math.max(1, ...rows.map((row) => row.sent));
    return `<div class="tpl-evolution" role="img" aria-label="Envios e respostas por ${unit} de envio">${rows.map((row) => `<div title="${esc(row.label)}: ${num(row.sent)} enviados, ${num(row.replied)} respondidos"><i style="--sent:${((row.sent / max) * 100).toFixed(1)}%;--replied:${row.sent ? ((row.replied / row.sent) * 100).toFixed(1) : 0}%"></i></div>`).join("")}</div>
      <div class="tpl-axis"><span>${esc(shortDate(series[0].day))}</span><span>por ${unit}</span><span>${esc(shortDate(series[series.length - 1].day))}</span></div>
      <div class="tpl-legend"><span><i class="soft"></i>Enviados</span><span><i></i>Respondidos (pelo dia do envio)</span></div>`;
  }

  function renderCommercial(report) {
    const max = Math.max(1, ...report.funnel.available.map((step) => step.value));
    $("#tpl-funnel").innerHTML = barRows(report.funnel.available, max);
    $("#tpl-pending").innerHTML = report.funnel.pending.map((item) => `<li><b>${esc(item.label)}<em>não coletado</em></b><span>${esc(item.reason)}</span></li>`).join("");
    $("#tpl-evolution").innerHTML = evolution(report.series);
  }

  function renderAuthors(report, updateFilter = true) {
    const filter = $("#tpl-author-filter");
    const groups = new Map();
    for (const row of report.byAuthorAndTemplate || []) {
      const key = row.userId ? `user:${row.userId}` : "unattributed";
      if (!groups.has(key)) groups.set(key, { key, name: row.authorName, sent: 0, categories: new Map(), rows: [] });
      const group = groups.get(key);
      group.sent += row.sent;
      const category = CATEGORY[row.category] || row.category || "Categoria não registrada";
      group.categories.set(category, (group.categories.get(category) || 0) + row.sent);
      group.rows.push(row);
    }
    const people = [...groups.values()].sort((a, b) => b.sent - a.sent || a.name.localeCompare(b.name));
    if (updateFilter) {
      const selected = filter.value;
      filter.innerHTML = '<option value="">Todas as pessoas</option>' + people.map((p) => `<option value="${esc(p.key)}">${esc(p.name)}</option>`).join("");
      filter.value = groups.has(selected) ? selected : "";
    }
    const visible = people.filter((p) => !filter.value || p.key === filter.value);
    $("#tpl-authors").innerHTML = visible.map((p) => `<details class="cost-secondary tpl-author"${filter.value ? " open" : ""}>
      <summary><strong>${esc(p.name)}</strong><span>${num(p.sent)} template(s) enviado(s)</span><small>${[...p.categories].map(([category, sent]) => `${esc(category)}: ${num(sent)}`).join(" · ")}</small></summary>
      <div class="cost-table"><table><thead><tr><th>Template</th><th>Categoria</th><th>Número utilizado</th><th>Enviados</th><th>Falhas</th></tr></thead><tbody>${p.rows.map((r) => `<tr><td>${esc(r.templateName || "Template sem nome registrado")}${r.language ? `<small> · ${esc(r.language)}</small>` : ""}</td><td>${esc(CATEGORY[r.category] || r.category || "Não registrada")}</td><td>${esc(r.accountName)}${r.displayNumber ? `<br><small>${esc(r.displayNumber)}</small>` : ""}</td><td>${num(r.sent)}</td><td>${num(r.failed)}</td></tr>`).join("")}</tbody></table></div>
    </details>`).join("") || '<div class="ops-empty">Nenhum envio de template neste período e número.</div>';
  }

  $("#tpl-author-filter").addEventListener("change", () => { if (state.report) renderAuthors(state.report, false); });

  function render(report) {
    state.report = report;
    const style = window.CompanyContext?.styleAttr?.(report.company) || "";
    const color = /--company-color:([^;"]+)/.exec(style)?.[1];
    for (const id of ["template-ranking", "template-authors", "template-commercial", "tpl-detail"]) {
      const element = document.getElementById(id);
      if (color) element.style.setProperty("--company-color", color.trim()); else element.style.removeProperty("--company-color");
    }
    const start = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date(report.period.start));
    const end = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date(report.period.end));
    $("#tpl-scope").textContent = `${report.company?.name || "Empresa ativa"} · ${start} a ${end}`;
    renderSummary(report.total);
    renderList();
    renderAuthors(report);
    renderCommercial(report);
  }

  async function load(scope) {
    if (scope) state.scope = scope;
    if (!state.scope?.company || state.scope.company === "ALL") return;
    if (state.period === "custom" && !(state.from && state.to)) return;
    const sequence = ++state.sequence;
    $("#tpl-list").setAttribute("aria-busy", "true");
    $("#tpl-author-filter").disabled = true;
    $("#tpl-authors").innerHTML = '<div class="ops-empty">Carregando…</div>';
    $("#tpl-author-filter").innerHTML = '<option value="">Todas as pessoas</option>';
    try {
      const report = await api(`/api/meta-costs/templates?${params()}`);
      if (sequence === state.sequence) render(report);
    } catch (error) {
      if (sequence !== state.sequence) return;
      state.report = null;
      $("#tpl-summary").innerHTML = "";
      $("#tpl-list").innerHTML = `<div class="ops-empty">${esc(error.message)}</div>`;
      $("#tpl-more").hidden = true;
      $("#tpl-authors").innerHTML = `<div class="ops-empty">${esc(error.message)}</div>`;
    } finally {
      if (sequence === state.sequence) {
        $("#tpl-list").removeAttribute("aria-busy");
        $("#tpl-author-filter").disabled = false;
      }
    }
  }

  async function openDetail(item) {
    const dialog = $("#tpl-detail");
    const sequence = ++state.detailSequence;
    $("#tpl-detail-title").textContent = templateLabel(item);
    $("#tpl-detail-meta").textContent = [CATEGORY[item.category] || item.category, item.language].filter(Boolean).join(" · ");
    $("#tpl-detail-body").innerHTML = `<div class="ops-empty">Carregando…</div>`;
    if (!dialog.open) dialog.showModal();
    if (!item.identified) {
      $("#tpl-detail-body").innerHTML = `<p class="ops-note">Estes envios não registraram o nome do template, então não há histórico individual. Eles continuam contados nos totais.</p>`;
      return;
    }
    try {
      const detail = await api(`/api/meta-costs/templates/detail?${params({ name: item.name, language: item.language || "" })}`);
      if (sequence !== state.detailSequence) return;
      const t = detail.total;
      $("#tpl-detail-body").innerHTML = `
        <div class="tpl-summary">${[["Enviados", num(t.sent)], ["Entregues", num(t.delivered)], ["Lidas", num(t.read)], ["Respondidos", `${num(t.replied)} / ${num(t.responseEligible)}`], ["Taxa de resposta", pct(t.responseRate)], ["Contatos que responderam", num(t.contactsReplied)]]
          .map(([label, value]) => `<div><span>${esc(label)}</span><b>${esc(value)}</b></div>`).join("")}</div>
        <p class="ops-note">Primeiro envio no período: ${esc(longDate(detail.template.firstSentAt))} · último: ${esc(longDate(detail.template.lastSentAt))}${t.failed ? ` · ${num(t.failed)} falha(s) não contadas como enviadas` : ""}${t.notEvaluable ? ` · ${num(t.notEvaluable)} envio(s) sem número identificado fora da taxa` : ""}. Respostas por citação: ${num(t.repliedByCitation)}; pelo último template do chat: ${num(t.replied - t.repliedByCitation)}.</p>
        <h3>Histórico (por dia de envio)</h3>${evolution(detail.series)}
        <h3>Por número</h3>
        <div class="cost-table"><table><thead><tr><th>Número</th><th>Enviados</th><th>Entregues</th><th>Lidas</th><th>Respostas</th><th>Taxa</th></tr></thead><tbody>${detail.byNumber.map((row) => `<tr><td>${esc(row.name)}</td><td>${num(row.sent)}</td><td>${num(row.delivered)}</td><td>${num(row.read)}</td><td>${num(row.replied)}</td><td>${pct(row.responseRate)}</td></tr>`).join("") || `<tr><td colspan="6">Sem envios.</td></tr>`}</tbody></table></div>
        ${detail.campaigns.length ? `<h3>Campanhas desta empresa com este template</h3><ul class="author-number-list">${detail.campaigns.map((campaign) => `<li class="author-number-row"><span>${esc(campaign.name)}</span><small>${esc(campaign.status)}</small></li>`).join("")}</ul>` : ""}`;
    } catch (error) {
      if (sequence === state.detailSequence) $("#tpl-detail-body").innerHTML = `<div class="ops-empty">${esc(error.message)}</div>`;
    }
  }

  function syncControls() {
    for (const button of document.querySelectorAll("[data-tpl-period]")) {
      const active = button.dataset.tplPeriod === state.period;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    for (const button of document.querySelectorAll("[data-tpl-sort]")) {
      const active = button.dataset.tplSort === state.sort;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    $("#tpl-custom").hidden = state.period !== "custom";
    $("#tpl-from").value = state.from || "";
    $("#tpl-to").value = state.to || "";
  }

  document.addEventListener("click", (event) => {
    const period = event.target.closest("[data-tpl-period]");
    if (period) {
      state.period = period.dataset.tplPeriod;
      state.expanded = false;
      remember(); syncControls();
      if (state.period === "custom") { if (state.from && state.to) load(); else $("#tpl-from").focus(); } else load();
      return;
    }
    const sort = event.target.closest("[data-tpl-sort]");
    if (sort) { state.sort = sort.dataset.tplSort; remember(); syncControls(); renderList(); return; }
    if (event.target.closest("#tpl-more")) { state.expanded = !state.expanded; renderList(); return; }
    const row = event.target.closest(".tpl-row");
    if (row && state.report) { openDetail(state.report.templates[Number(row.dataset.index)]); return; }
    if (event.target.closest("[data-tpl-close]")) $("#tpl-detail").close();
  });
  $("#tpl-detail").addEventListener("click", (event) => { if (event.target === event.currentTarget) event.currentTarget.close(); });
  $("#tpl-custom").addEventListener("submit", (event) => {
    event.preventDefault();
    state.from = $("#tpl-from").value; state.to = $("#tpl-to").value;
    if (state.from > state.to) { $("#tpl-list").innerHTML = `<div class="ops-empty">A data inicial precisa ser anterior à final.</div>`; return; }
    state.expanded = false; remember(); load();
  });
  if (!["7d", "30d", "90d", "custom"].includes(state.period)) state.period = "30d";
  if (!["sent", "rate"].includes(state.sort)) state.sort = "sent";
  syncControls();

  window.TemplateRanking = { load };
})();
