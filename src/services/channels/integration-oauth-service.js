// Infraestrutura OAuth compartilhada: state/CSRF, troca e refresh de tokens,
// além da descoberta de identidade externa sem expor credenciais.
const crypto = require("node:crypto");
const axios = require("axios");
const prisma = require("../../database/prisma");
const { encryptSecrets, decryptSecrets } = require("./integration-secret-service");
const { getOAuthProvider } = require("./oauth-providers");

const STATE_TTL_MINUTES = 15;

async function createAuthorizationRequest({ channel, channelAccountId = null, provider, clientId, redirectUri, scopes = [], extraParams = {}, actorUserId = null, context = {} }) {
  const config = getOAuthProvider(provider);
  const state = crypto.randomBytes(24).toString("hex");
  const codeVerifier = config.usePkce ? crypto.randomBytes(48).toString("base64url") : null;
  await prisma.channelOAuthState.create({
    data: {
      channel, channelAccountId, state, redirectUri,
      expiresAt: new Date(Date.now() + STATE_TTL_MINUTES * 60 * 1000),
      metadata: { ...context, provider, actorUserId, ...(codeVerifier ? { codeVerifier } : {}) },
    },
  });
  const url = new URL(config.authorizationUrl);
  url.searchParams.set(config.authorizationClientIdParam || "client_id", clientId);
  if (config.includeRedirectUriInAuthorization !== false) url.searchParams.set("redirect_uri", redirectUri);
  if (config.includeResponseTypeInAuthorization !== false) url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  if (scopes.length) url.searchParams.set("scope", scopes.join(" "));
  if (codeVerifier) {
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("code_challenge", crypto.createHash("sha256").update(codeVerifier).digest("base64url"));
  }
  for (const [key, value] of Object.entries({ ...config.extraAuthParams, ...extraParams })) url.searchParams.set(key, value);
  return { url: url.toString(), state };
}

async function consumeState(state, actorUserId) {
  const record = await prisma.channelOAuthState.findUnique({ where: { state } });
  if (!record) throw Object.assign(new Error("State OAuth inválido ou desconhecido."), { statusCode: 400 });
  if (!actorUserId || record.metadata?.actorUserId !== actorUserId) throw Object.assign(new Error("State OAuth pertence a outra sessão administrativa."), { statusCode: 403 });
  if (record.consumedAt) throw Object.assign(new Error("State OAuth já utilizado."), { statusCode: 400 });
  if (record.expiresAt < new Date()) throw Object.assign(new Error("State OAuth expirado."), { statusCode: 400 });
  const consumedAt = new Date();
  const claimed = await prisma.channelOAuthState.updateMany({
    where: { state, consumedAt: null, expiresAt: { gt: consumedAt } }, data: { consumedAt },
  });
  if (claimed.count !== 1) throw Object.assign(new Error("State OAuth já utilizado ou expirado."), { statusCode: 400 });
  return record;
}

async function exchangeCodeForToken({ provider, code, clientId, clientSecret, redirectUri, codeVerifier = null }) {
  const config = getOAuthProvider(provider);
  try {
    const params = { grant_type: "authorization_code", code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri };
    if (codeVerifier) params.code_verifier = codeVerifier;
    const response = await axios.post(config.tokenUrl, new URLSearchParams(params), { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 10000 });
    return response.data;
  } catch (error) {
    throw Object.assign(new Error("Falha ao trocar o código de autorização pelo token."), { statusCode: 502, channelErrorCode: "AUTH_ERROR", providerStatus: error.response?.status });
  }
}

async function refreshAccessToken({ provider, refreshToken, clientId, clientSecret }) {
  const config = getOAuthProvider(provider);
  try {
    const response = await axios.post(config.tokenUrl, new URLSearchParams({
      grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret,
    }), { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 10000 });
    return response.data;
  } catch (error) {
    throw Object.assign(new Error("Falha ao renovar o token de acesso."), { statusCode: 502, channelErrorCode: "TOKEN_EXPIRED", providerStatus: error.response?.status });
  }
}

function tokenExpiresAt(token) {
  const seconds = Number(token?.expires_in);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(Date.now() + seconds * 1000) : null;
}

async function discoverOAuthAccounts({ provider, channel, accessToken, callbackMetadata = {} }) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  try {
    if (provider === "GOOGLE" && channel === "EMAIL") {
      const { data } = await axios.get("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers, timeout: 8000 });
      return [{ id: data.emailAddress, name: data.emailAddress, username: data.emailAddress, config: { provider: "GMAIL", emailAddress: data.emailAddress } }];
    }
    if (provider === "GOOGLE" && channel === "GOOGLE_REVIEWS") {
      const { data } = await axios.get("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", { headers, timeout: 8000 });
      const account = data.accounts?.[0];
      if (!account) return [];
      let location = null;
      try {
        const locations = await axios.get(`https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations`, {
          headers, params: { readMask: "name,title,storeCode" }, timeout: 8000,
        });
        location = locations.data?.locations?.[0] || null;
      } catch (_error) {}
      return [{ id: account.name, name: account.accountName || account.name, username: location?.title || null, config: { googleAccountName: account.name, googleLocationName: location?.name || null } }];
    }
    if (provider === "MICROSOFT") {
      const { data } = await axios.get("https://graph.microsoft.com/v1.0/me", { headers, timeout: 8000 });
      const email = data.mail || data.userPrincipalName;
      return [{ id: data.id, name: data.displayName || email, username: email, config: { provider: "MICROSOFT_365", emailAddress: email } }];
    }
    if (provider === "AMAZON") {
      const sellerId = callbackMetadata.sellingPartnerId;
      return sellerId ? [{ id: String(sellerId), name: `Amazon ${sellerId}`, username: String(sellerId), config: { sellingPartnerId: String(sellerId) } }] : [];
    }
    if (provider === "MERCADO_LIVRE") {
      const { data } = await axios.get("https://api.mercadolibre.com/users/me", { headers, timeout: 8000 });
      return [{ id: String(data.id), name: data.nickname || String(data.id), username: data.nickname || null, config: { sellerId: String(data.id) } }];
    }
    if (provider === "META") {
      const version = process.env.GRAPH_VERSION || "v21.0";
      const { data } = await axios.get(`https://graph.facebook.com/${version}/me/accounts`, {
        params: { fields: "id,name,access_token,instagram_business_account{id,username}", access_token: accessToken }, timeout: 10000,
      });
      const instagram = channel.startsWith("INSTAGRAM_");
      return (data.data || []).flatMap((page) => {
        if (instagram && !page.instagram_business_account?.id) return [];
        const external = instagram ? page.instagram_business_account : page;
        return [{
          id: String(external.id), name: instagram ? (external.username || page.name) : page.name,
          username: instagram ? external.username : page.name,
          config: instagram ? { igUserId: String(external.id), pageId: String(page.id) } : { pageId: String(page.id) },
          secretPatch: instagram ? { igAccessToken: page.access_token } : { pageAccessToken: page.access_token },
        }];
      });
    }
    return [];
  } catch (error) {
    throw Object.assign(new Error("Não foi possível identificar as contas autorizadas no provider."), { statusCode: 502, channelErrorCode: error.response?.status === 401 ? "TOKEN_EXPIRED" : "PROVIDER_ERROR" });
  }
}

async function refreshAccountIfNeeded(account, { force = false } = {}) {
  if (!account?.oauthProvider || !account.encryptedSecrets) return account;
  if (!force && (!account.tokenExpiresAt || account.tokenExpiresAt.getTime() > Date.now() + 60000)) return account;
  const config = getOAuthProvider(account.oauthProvider);
  const secrets = decryptSecrets(account);
  if (!secrets.refreshToken) return prisma.channelAccount.update({ where: { id: account.id }, data: { status: "RECONNECT_REQUIRED" } });
  try {
    const token = await refreshAccessToken({
      provider: account.oauthProvider, refreshToken: secrets.refreshToken,
      clientId: process.env[config.tokenClientIdEnv || config.clientIdEnv], clientSecret: process.env[config.clientSecretEnv],
    });
    const merged = { ...secrets, accessToken: token.access_token, refreshToken: token.refresh_token || secrets.refreshToken };
    return prisma.channelAccount.update({
      where: { id: account.id },
      data: { ...encryptSecrets(merged), tokenExpiresAt: tokenExpiresAt(token), status: "CONNECTED", lastErrorAt: null, lastErrorCode: null, lastErrorMessage: null },
    });
  } catch (_error) {
    return prisma.channelAccount.update({
      where: { id: account.id },
      data: { status: "RECONNECT_REQUIRED", lastErrorAt: new Date(), lastErrorCode: "TOKEN_EXPIRED", lastErrorMessage: "Reconecte a conta para renovar a autorização." },
    });
  }
}

module.exports = { consumeState, createAuthorizationRequest, discoverOAuthAccounts, exchangeCodeForToken, refreshAccessToken, refreshAccountIfNeeded, tokenExpiresAt };
