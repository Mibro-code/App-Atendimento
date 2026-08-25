// Infraestrutura de OAuth reutilizável entre providers (item 13): gera
// state, valida callback (proteção CSRF/replay), troca code por token e
// devolve os campos prontos para o secret storage cifrar. Cada adapter
// decide QUAIS scopes pedir; este serviço só cuida do fluxo genérico.
const crypto = require("node:crypto");
const axios = require("axios");
const prisma = require("../../database/prisma");
const { getOAuthProvider } = require("./oauth-providers");

const STATE_TTL_MINUTES = 15;

async function createAuthorizationRequest({ channel, channelAccountId = null, provider, clientId, redirectUri, scopes = [], extraParams = {} }) {
  const config = getOAuthProvider(provider);
  const state = crypto.randomBytes(24).toString("hex");
  await prisma.channelOAuthState.create({
    data: {
      channel, channelAccountId, state, redirectUri,
      expiresAt: new Date(Date.now() + STATE_TTL_MINUTES * 60 * 1000),
      metadata: { provider },
    },
  });
  const url = new URL(config.authorizationUrl);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  if (scopes.length) url.searchParams.set("scope", scopes.join(" "));
  for (const [key, value] of Object.entries({ ...config.extraAuthParams, ...extraParams })) url.searchParams.set(key, value);
  return { url: url.toString(), state };
}

// Uso único: consome o state na primeira validação (protege contra replay).
async function consumeState(state) {
  const record = await prisma.channelOAuthState.findUnique({ where: { state } });
  if (!record) throw Object.assign(new Error("State OAuth inválido ou desconhecido."), { statusCode: 400 });
  if (record.consumedAt) throw Object.assign(new Error("State OAuth já utilizado."), { statusCode: 400 });
  if (record.expiresAt < new Date()) throw Object.assign(new Error("State OAuth expirado."), { statusCode: 400 });
  await prisma.channelOAuthState.update({ where: { state }, data: { consumedAt: new Date() } });
  return record;
}

async function exchangeCodeForToken({ provider, code, clientId, clientSecret, redirectUri }) {
  const config = getOAuthProvider(provider);
  try {
    const response = await axios.post(config.tokenUrl, new URLSearchParams({
      grant_type: "authorization_code", code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri,
    }), { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 10000 });
    return response.data;
  } catch (error) {
    throw Object.assign(new Error("Falha ao trocar o código de autorização pelo token."), {
      statusCode: 502, channelErrorCode: "AUTH_ERROR", providerStatus: error.response?.status,
    });
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
    throw Object.assign(new Error("Falha ao renovar o token de acesso."), {
      statusCode: 502, channelErrorCode: "TOKEN_EXPIRED", providerStatus: error.response?.status,
    });
  }
}

module.exports = { consumeState, createAuthorizationRequest, exchangeCodeForToken, refreshAccessToken };
