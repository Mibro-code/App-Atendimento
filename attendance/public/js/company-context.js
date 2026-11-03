// Multiempresa nas telas administrativas (Bots, Campanhas, Respostas
// Rápidas, Integrações): empresas acessíveis ao usuário, badge, seletor e
// filtro de empresa. Só apresentação — toda regra de acesso é validada no
// backend. A cor vem sempre de company.primaryColor.
// Workspaces: o filtro segue o workspace ativo da Central (MIBRO | SINCROFIT,
// sem "Todas"); trocar aqui troca o workspace salvo. Só telas de configuração
// com camada global de verdade (ex.: Configurações → Global) passam allLabel.
(function companyContext() {
  const esc = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  const color = (company) => (/^#[0-9a-f]{6}$/i.test(company?.primaryColor || "") ? company.primaryColor : "");
  const styleAttr = (company) => (color(company) ? ` style="--company-color:${color(company)}"` : "");
  let loading = null;
  const ctx = {
    companies: [],
    preference: "",
    async load() {
      loading ||= fetch("/api/companies", { credentials: "same-origin" })
        .then((response) => (response.ok ? response.json() : { companies: [], preference: "" }))
        .then((data) => {
          ctx.companies = data.companies || [];
          ctx.preference = ctx.companies.some((company) => company.slug === data.preference) ? data.preference : ctx.companies[0]?.slug || "";
          return ctx;
        });
      return loading;
    },
    multi() { return ctx.companies.length > 1; },
    // Workspace ativo (slug de uma empresa acessível).
    workspace() { return ctx.companies.some((company) => company.slug === ctx.preference) ? ctx.preference : ctx.companies[0]?.slug || ""; },
    byId(id) { return ctx.companies.find((company) => company.id === id) || null; },
    styleAttr,
    badge(company) {
      if (!company) return "";
      return `<span class="company-badge"${styleAttr(company)} title="${esc(company.name)}">${esc(company.displayName || company.name)}</span>`;
    },
    // <select> de empresa para formulários de criação ("selecionar empresa
    // primeiro"). Com uma empresa só, fica escondido e já preenchido.
    selectHtml(id, { value = "", allowGlobal = false, label = "Empresa" } = {}) {
      const options = [
        ...(allowGlobal ? [`<option value="">Todas as empresas (global)</option>`] : (ctx.multi() ? [`<option value="" disabled ${value ? "" : "selected"}>Selecione a empresa</option>`] : [])),
        ...ctx.companies.map((company) => `<option value="${esc(company.id)}" ${company.id === value ? "selected" : ""}>${esc(company.name)}</option>`),
      ];
      const hidden = !ctx.multi() && !allowGlobal;
      return `<label class="company-select-field"${hidden ? " hidden" : ""}><span>${esc(label)}</span><select id="${esc(id)}" ${allowGlobal ? "" : "required"}>${options.join("")}</select></label>`;
    },
    // Filtro segmentado; chama onChange(slug). Devolve a empresa inicial.
    // "ALL" só existe com allLabel (camada global de configuração).
    mountFilter(container, onChange, initial = ctx.preference, { allLabel = null } = {}) {
      const allowAll = Boolean(allLabel);
      let current = initial;
      if (!allowAll && !ctx.companies.some((company) => company.slug === current)) current = ctx.workspace();
      if (!container) return current;
      const render = () => {
        container.hidden = !ctx.multi();
        container.classList.add("company-filter");
        container.innerHTML = [...(allowAll ? [{ slug: "ALL", displayName: allLabel, name: allLabel }] : []), ...ctx.companies]
          .map((company) => `<button type="button" class="${company.slug === current ? "active" : ""}" data-company-filter="${esc(company.slug)}"${styleAttr(company)} title="${esc(company.name)}">${company.slug === "ALL" ? "" : `<i class="company-dot"></i>`}${esc(company.slug === "ALL" ? allLabel : company.displayName)}</button>`).join("");
      };
      container.addEventListener("click", (event) => {
        const button = event.target.closest("[data-company-filter]");
        if (!button || button.dataset.companyFilter === current) return;
        current = button.dataset.companyFilter;
        render();
        if (current !== "ALL") {
          ctx.preference = current;
          fetch("/api/companies/preference", { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ company: current }) }).catch(() => {});
        }
        onChange(current);
      });
      render();
      return current;
    },
  };
  window.CompanyContext = ctx;
})();
