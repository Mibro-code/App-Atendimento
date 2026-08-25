const $ = (selector) => document.querySelector(selector);
const state = { overview: [], settings: null, editingChannel: null };

const CHANNEL_LABELS = {
  META: "WhatsApp (Meta)",
  INSTAGRAM_DIRECT: "Instagram Direct",
  INSTAGRAM_COMMENTS: "Instagram Comentários",
  FACEBOOK_MESSENGER: "Facebook Messenger",
  FACEBOOK_COMMENTS: "Facebook Comentários",
  EMAIL: "E-mail",
  MERCADO_LIVRE: "Mercado Livre",
  TIKTOK_SHOP: "TikTok Shop",
  AMAZON_MARKETPLACE: "Amazon Marketplace",
  SHOPEE: "Shopee",
  GOOGLE_REVIEWS: "Google Reviews / Perfil da Empresa",
  RECLAME_AQUI: "Reclame Aqui",
};

const STATUS_LABELS = {
  DISABLED: "Desativado", NOT_CONFIGURED: "Não configurado", CONFIGURED: "Configurado, aguardando teste",
  AUTH_PENDING: "Autorização pendente", CONNECTED: "Conectado", DEGRADED: "Degradado",
  ERROR: "Erro", NOT_SUPPORTED: "Ainda não suportado",
};

// Campos por canal (item 6/9) — nenhum canal aqui aceita um endpoint
// inventado: os que ainda não têm API confirmada (Shopee, Reclame Aqui)
// só guardam configuração básica para quando o acesso for liberado.
const CHANNEL_FIELDS = {
  META: null,
  EMAIL: [
    { key: "config.provider", label: "Provedor (GMAIL ou MICROSOFT_365)", secret: false },
    { key: "secrets.accessToken", label: "Access token (OAuth)", secret: true },
    { key: "secrets.refreshToken", label: "Refresh token (OAuth)", secret: true, optional: true },
  ],
  MERCADO_LIVRE: [
    { key: "config.sellerId", label: "Seller ID (opcional)", secret: false, optional: true },
    { key: "secrets.accessToken", label: "Access token (OAuth)", secret: true },
    { key: "secrets.refreshToken", label: "Refresh token (OAuth)", secret: true, optional: true },
  ],
  TIKTOK_SHOP: [
    { key: "config.appKey", label: "App Key" },
    { key: "config.appSecret", label: "App Secret", secret: true },
    { key: "config.shopId", label: "Shop ID" },
    { key: "secrets.accessToken", label: "Access token (OAuth)", secret: true, optional: true },
  ],
  AMAZON_MARKETPLACE: [
    { key: "config.lwaClientId", label: "LWA Client ID" },
    { key: "config.lwaClientSecret", label: "LWA Client Secret", secret: true },
    { key: "secrets.refreshToken", label: "Refresh token (gerado no Seller Central)", secret: true },
  ],
  SHOPEE: [
    { key: "config.partnerId", label: "Partner ID", optional: true },
    { key: "config.shopId", label: "Shop ID", optional: true },
    { key: "config.partnerKey", label: "Partner Key", secret: true, optional: true },
  ],
  GOOGLE_REVIEWS: [
    { key: "secrets.accessToken", label: "Access token (OAuth)", secret: true },
    { key: "secrets.refreshToken", label: "Refresh token (OAuth)", secret: true, optional: true },
  ],
  RECLAME_AQUI: [
    { key: "config.companyId", label: "ID da empresa no Reclame Aqui", optional: true },
  ],
};

async function api(url, options = {}) {
  const headers = { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) };
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) { location.replace("/login.html"); throw new Error("Sessão encerrada."); }
  const body = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || "Não foi possível concluir a operação.");
  return body;
}

function toast(message, error = false) {
  const element = $("#toast");
  element.textContent = message;
  element.className = `toast show${error ? " error" : ""}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { element.className = "toast"; }, 3200);
}

function statusBadgeClass(status) {
  if (status === "CONNECTED") return "status-ok";
  if (["ERROR", "DEGRADED"].includes(status)) return "status-error";
  if (["AUTH_PENDING", "CONFIGURED"].includes(status)) return "status-pending";
  return "status-idle";
}

function renderCards() {
  const container = $("#channel-cards");
  container.innerHTML = state.overview.map((entry) => {
    const isMeta = entry.channel === "META";
    const accounts = entry.accounts || [];
    const capabilities = entry.capabilities || {};
    const capBadges = Object.entries(capabilities)
      .filter(([, value]) => value)
      .map(([key]) => `<span class="cap-badge">${key.replace(/^can|^supports/, "").replace(/([A-Z])/g, " $1").trim()}</span>`)
      .join("");

    const accountsHtml = accounts.length ? accounts.map((account) => `
      <div class="account-row" data-account-id="${account.id}">
        <div class="account-row-main">
          <strong>${account.name}</strong>
          <span class="status-pill ${statusBadgeClass(account.status)}">${STATUS_LABELS[account.status] || account.status}</span>
          <span class="enabled-pill ${account.enabled ? "on" : "off"}">${account.enabled ? "Ativado" : "Desativado"}</span>
        </div>
        <div class="account-row-meta">
          ${account.lastSyncAt ? `<span>Última sincronização: ${new Date(account.lastSyncAt).toLocaleString("pt-BR")}</span>` : ""}
          ${account.lastErrorMessage ? `<span class="error-text">Erro: ${account.lastErrorMessage}</span>` : ""}
        </div>
        <div class="account-row-actions">
          <button type="button" data-action="test" data-id="${account.id}">Testar conexão</button>
          <button type="button" data-action="toggle" data-id="${account.id}" data-enabled="${account.enabled}">${account.enabled ? "Desativar" : "Ativar"}</button>
          <button type="button" data-action="delete" data-id="${account.id}" class="danger">Remover</button>
        </div>
      </div>
    `).join("") : `<p class="no-accounts">Nenhuma conta configurada.</p>`;

    return `
      <section class="channel-card ${isMeta ? "channel-card-meta" : ""}">
        <header>
          <h2>${CHANNEL_LABELS[entry.channel] || entry.channel}</h2>
          ${entry.adapterAvailable ? "" : '<span class="status-pill status-idle">Sem adapter</span>'}
        </header>
        <div class="cap-badges">${capBadges || '<span class="cap-badge cap-badge-empty">Sem capacidades ativas nesta fase</span>'}</div>
        ${isMeta
          ? '<p class="meta-note">Gerenciado pelas variáveis de ambiente originais do WhatsApp — este painel não altera essa integração.</p>'
          : `<div class="account-list">${accountsHtml}</div>
             <button type="button" class="add-account" data-channel="${entry.channel}">+ Adicionar conta</button>`
        }
      </section>
    `;
  }).join("");

  container.querySelectorAll(".add-account").forEach((button) => (
    button.addEventListener("click", () => openAccountDialog(button.dataset.channel))
  ));
  container.querySelectorAll('[data-action="test"]').forEach((button) => (
    button.addEventListener("click", () => testConnection(button.dataset.id))
  ));
  container.querySelectorAll('[data-action="toggle"]').forEach((button) => (
    button.addEventListener("click", () => toggleAccount(button.dataset.id, button.dataset.enabled !== "true"))
  ));
  container.querySelectorAll('[data-action="delete"]').forEach((button) => (
    button.addEventListener("click", () => deleteAccount(button.dataset.id))
  ));
}

function openAccountDialog(channel) {
  state.editingChannel = channel;
  $("#account-dialog-title").textContent = "Nova conta";
  $("#account-dialog-channel").textContent = CHANNEL_LABELS[channel] || channel;
  $("#account-name").value = "";
  const fields = CHANNEL_FIELDS[channel] || [];
  $("#account-secret-fields").innerHTML = fields.map((field) => `
    <label>${field.label}${field.optional ? " (opcional)" : ""}
      <input type="${field.secret ? "password" : "text"}" data-field-key="${field.key}" ${field.optional ? "" : "required"}>
    </label>
  `).join("");
  $("#account-dialog").showModal();
}

async function saveAccount(event) {
  event.preventDefault();
  const channel = state.editingChannel;
  const name = $("#account-name").value.trim();
  if (!name) return toast("Informe um nome para a conta.", true);

  const config = {};
  const secrets = {};
  document.querySelectorAll("#account-secret-fields [data-field-key]").forEach((input) => {
    const value = input.value.trim();
    if (!value) return;
    const [group, key] = input.dataset.fieldKey.split(".");
    if (group === "secrets") secrets[key] = value;
    else config[key] = value;
  });

  try {
    await api("/api/integrations/accounts", { method: "POST", body: JSON.stringify({ channel, name, config, secrets }) });
    toast("Conta criada. Use \"Testar conexão\" para validar as credenciais.");
    $("#account-dialog").close();
    await loadOverview();
  } catch (error) { toast(error.message, true); }
}

async function testConnection(accountId) {
  try {
    const result = await api(`/api/integrations/accounts/${accountId}/test-connection`, { method: "POST" });
    toast(`Status: ${STATUS_LABELS[result.status] || result.status}${result.message ? ` — ${result.message}` : ""}`, result.status !== "CONNECTED");
  } catch (error) { toast(error.message, true); }
  await loadOverview();
}

async function toggleAccount(accountId, enabled) {
  try {
    await api(`/api/integrations/accounts/${accountId}/enabled`, { method: "PATCH", body: JSON.stringify({ enabled }) });
    toast(enabled ? "Conta ativada." : "Conta desativada.");
    await loadOverview();
  } catch (error) { toast(error.message, true); }
}

async function deleteAccount(accountId) {
  if (!confirm("Remover esta conta de integração? As credenciais salvas serão apagadas.")) return;
  try {
    await api(`/api/integrations/accounts/${accountId}`, { method: "DELETE" });
    toast("Conta removida.");
    await loadOverview();
  } catch (error) { toast(error.message, true); }
}

async function loadOverview() {
  state.overview = await api("/api/integrations/overview");
  renderCards();
}

async function loadSettings() {
  state.settings = await api("/api/integrations/settings");
  $("#new-channels-toggle").checked = Boolean(state.settings.newChannelsEnabled);
}

$("#account-form").addEventListener("submit", saveAccount);
$("#account-cancel").addEventListener("click", () => $("#account-dialog").close());
$("#new-channels-toggle").addEventListener("change", async (event) => {
  try {
    await api("/api/integrations/settings", { method: "PATCH", body: JSON.stringify({ newChannelsEnabled: event.target.checked }) });
    toast(event.target.checked ? "Novos canais permitidos." : "Novos canais bloqueados (WhatsApp continua ativo).");
  } catch (error) {
    event.target.checked = !event.target.checked;
    toast(error.message, true);
  }
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

(async () => {
  try {
    const status = await api("/api/auth/status");
    if (!status.authenticated || !status.user.isMaster) return location.replace("/");
    $("#current-user").textContent = status.user.name;
    await Promise.all([loadOverview(), loadSettings()]);
  } catch (error) { toast(error.message, true); }
})();
