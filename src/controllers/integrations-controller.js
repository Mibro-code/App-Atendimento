// Painel de Integrações (item 6) — só Master. Nunca devolve segredo cru;
// channel-account-service já cuida disso.
const accounts = require("../services/channels/channel-account-service");
const globalSettings = require("../services/channels/integration-global-settings-service");
const oauth = require("../services/channels/integration-oauth-service");
const { getOAuthProvider } = require("../services/channels/oauth-providers");

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
    try { return res.json(await accounts.setEnabled(req.params.accountId, Boolean(req.body.enabled), req.user)); }
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
    try { return res.json(await globalSettings.getGlobalSettings()); }
    catch (error) { return next(error); }
  },

  async setGlobalSettings(req, res, next) {
    try { return res.json(await globalSettings.setNewChannelsEnabled(Boolean(req.body.newChannelsEnabled), req.user)); }
    catch (error) { return next(error); }
  },

  // Fluxo OAuth (item 13) — quem chama já sabe channel/provider/channelAccountId
  // (a tela de configuração escolhe o provider antes de abrir esta URL).
  async oauthStart(req, res, next) {
    try {
      accounts.assertIntegrationManager(req.user);
      const { channel, channelAccountId, provider, scopes } = req.body;
      const config = getOAuthProvider(provider);
      const clientId = process.env[config.clientIdEnv];
      const redirectUri = process.env[config.redirectUriEnv] || req.body.redirectUri;
      if (!clientId || !redirectUri) {
        return res.status(400).json({ error: `Credenciais de app OAuth (${config.clientIdEnv}) não configuradas no servidor.` });
      }
      const result = await oauth.createAuthorizationRequest({
        channel, channelAccountId: channelAccountId || null, provider, clientId, redirectUri,
        scopes: Array.isArray(scopes) ? scopes : config.defaultScopes || [],
      });
      return res.json(result);
    } catch (error) { return next(error); }
  },

  async oauthCallback(req, res, next) {
    try {
      accounts.assertIntegrationManager(req.user);
      const { state, code, provider, channelAccountId } = req.body;
      const record = await oauth.consumeState(state);
      const config = getOAuthProvider(provider || record.metadata?.provider);
      const clientId = process.env[config.clientIdEnv];
      const clientSecret = process.env[config.clientSecretEnv];
      const token = await oauth.exchangeCodeForToken({
        provider: provider || record.metadata?.provider, code, clientId, clientSecret, redirectUri: record.redirectUri,
      });
      const targetAccountId = channelAccountId || record.channelAccountId;
      if (targetAccountId) {
        await accounts.updateAccount(targetAccountId, {
          secrets: { accessToken: token.access_token, refreshToken: token.refresh_token || undefined },
        }, req.user);
      }
      return res.json({ connected: true, channelAccountId: targetAccountId || null });
    } catch (error) { return next(error); }
  },
};
