// Painel de Integrações (item 6) — só Master. Nunca devolve segredo cru;
// channel-account-service já cuida disso.
const accounts = require("../services/channels/channel-account-service");
const globalSettings = require("../services/channels/integration-global-settings-service");
const oauth = require("../services/channels/integration-oauth-service");
const { getOAuthProvider, getOAuthScopes } = require("../services/channels/oauth-providers");
const OAUTH_PROVIDERS_BY_CHANNEL = Object.freeze({
  EMAIL: ["GOOGLE", "MICROSOFT"],
  GOOGLE_REVIEWS: ["GOOGLE"],
  MERCADO_LIVRE: ["MERCADO_LIVRE"],
});

module.exports = {
  async overview(req, res, next) {
    try { return res.json(await accounts.listChannelOverview(req.user)); }
    catch (error) { return next(error); }
  },

  async list(req, res, next) {
    try { return res.json(await accounts.listAccounts(req.user)); }
    catch (error) { return next(error); }
  },

  async detail(req, res, next) {
    try { return res.json(await accounts.getAccount(req.params.accountId, req.user)); }
    catch (error) { return next(error); }
  },

  async create(req, res, next) {
    try { return res.status(201).json(await accounts.createAccount(req.body, req.user)); }
    catch (error) { return next(error); }
  },

  async update(req, res, next) {
    try { return res.json(await accounts.updateAccount(req.params.accountId, req.body, req.user)); }
    catch (error) { return next(error); }
  },

  async setEnabled(req, res, next) {
    try { return res.json(await accounts.setEnabled(req.params.accountId, req.body.enabled, req.user)); }
    catch (error) { return next(error); }
  },

  async remove(req, res, next) {
    try { return res.json(await accounts.deleteAccount(req.params.accountId, req.user)); }
    catch (error) { return next(error); }
  },

  async testConnection(req, res, next) {
    try { return res.json(await accounts.testConnection(req.params.accountId, req.user)); }
    catch (error) { return next(error); }
  },

  async getGlobalSettings(req, res, next) {
    try { return res.json(await globalSettings.getGlobalSettingsForManager(req.user)); }
    catch (error) { return next(error); }
  },

  async setGlobalSettings(req, res, next) {
    try { return res.json(await globalSettings.setNewChannelsEnabled(req.body.newChannelsEnabled, req.user)); }
    catch (error) { return next(error); }
  },

  // Fluxo OAuth (item 13) — quem chama já sabe channel/provider/channelAccountId
  // (a tela de configuração escolhe o provider antes de abrir esta URL).
  async oauthStart(req, res, next) {
    try {
      accounts.assertIntegrationManager(req.user);
      const { channel, channelAccountId, provider } = req.body;
      if (!channelAccountId) return res.status(400).json({ error: "channelAccountId é obrigatório para OAuth." });
      const target = await accounts.getAccount(channelAccountId, req.user);
      if (target.channel !== channel) return res.status(400).json({ error: "Conta OAuth não corresponde ao canal informado." });
      if (!OAUTH_PROVIDERS_BY_CHANNEL[channel]?.includes(provider)) {
        return res.status(400).json({ error: "Provider OAuth não permitido para este canal." });
      }
      const config = getOAuthProvider(provider);
      const clientId = process.env[config.clientIdEnv];
      const redirectUri = process.env[config.redirectUriEnv];
      if (!clientId || !redirectUri) {
        return res.status(400).json({ error: `Credenciais de app OAuth (${config.clientIdEnv}) não configuradas no servidor.` });
      }
      const result = await oauth.createAuthorizationRequest({
        channel, channelAccountId: channelAccountId || null, provider, clientId, redirectUri,
        scopes: getOAuthScopes(provider, channel), actorUserId: req.user.id,
      });
      return res.json(result);
    } catch (error) { return next(error); }
  },

  async oauthCallback(req, res, next) {
    try {
      accounts.assertIntegrationManager(req.user);
      const { state, code } = req.body;
      if (typeof state !== "string" || !state || typeof code !== "string" || !code) {
        return res.status(400).json({ error: "State e código OAuth são obrigatórios." });
      }
      const record = await oauth.consumeState(state, req.user.id);
      const provider = record.metadata?.provider;
      const config = getOAuthProvider(provider);
      const clientId = process.env[config.clientIdEnv];
      const clientSecret = process.env[config.clientSecretEnv];
      if (!clientId || !clientSecret) return res.status(400).json({ error: "Credenciais OAuth não configuradas no servidor." });
      const token = await oauth.exchangeCodeForToken({
        provider, code, clientId, clientSecret, redirectUri: record.redirectUri,
      });
      if (!token?.access_token) return res.status(502).json({ error: "Provider OAuth não devolveu access_token." });
      const targetAccountId = record.channelAccountId;
      if (!targetAccountId) return res.status(400).json({ error: "Conta vinculada ao OAuth não está mais disponível." });
      const target = await accounts.getAccount(targetAccountId, req.user);
      if (target.channel !== record.channel) return res.status(400).json({ error: "Conta OAuth não corresponde ao canal autorizado." });
      const tokenSecrets = { accessToken: token.access_token };
      if (token.refresh_token) tokenSecrets.refreshToken = token.refresh_token;
      await accounts.updateAccount(targetAccountId, { secrets: tokenSecrets }, req.user);
      return res.json({ connected: true, channelAccountId: targetAccountId || null });
    } catch (error) { return next(error); }
  },
};
