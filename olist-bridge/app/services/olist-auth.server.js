import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import db from "../db.server";

const DEFAULT_AUTHORIZATION_URL =
  "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth";
const DEFAULT_TOKEN_URL =
  "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const TOKEN_REFRESH_MARGIN_MS = 60 * 1000;

const REQUIRED_CONFIGURATION = [
  "OLIST_CLIENT_ID",
  "OLIST_CLIENT_SECRET",
  "OLIST_REDIRECT_URI",
  "OLIST_TOKEN_ENCRYPTION_KEY",
];

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Variavel obrigatoria ausente: ${name}`);
  }

  return value;
}

function getConfiguration() {
  const redirectUri = requiredEnvironment("OLIST_REDIRECT_URI");

  try {
    const parsedRedirectUri = new URL(redirectUri);
    if (parsedRedirectUri.protocol !== "https:") {
      throw new Error("OLIST_REDIRECT_URI precisa usar HTTPS.");
    }
  } catch (error) {
    if (error.message === "OLIST_REDIRECT_URI precisa usar HTTPS.") {
      throw error;
    }
    throw new Error("OLIST_REDIRECT_URI precisa ser uma URL valida.");
  }

  return {
    clientId: requiredEnvironment("OLIST_CLIENT_ID"),
    clientSecret: requiredEnvironment("OLIST_CLIENT_SECRET"),
    redirectUri,
    authorizationUrl:
      process.env.OLIST_AUTHORIZATION_URL?.trim() || DEFAULT_AUTHORIZATION_URL,
    tokenUrl: process.env.OLIST_TOKEN_URL?.trim() || DEFAULT_TOKEN_URL,
  };
}

function getEncryptionKey() {
  const encodedKey = requiredEnvironment("OLIST_TOKEN_ENCRYPTION_KEY");
  const encoding = /^[0-9a-f]{64}$/i.test(encodedKey) ? "hex" : "base64";
  const key = Buffer.from(encodedKey, encoding);

  if (key.length !== 32) {
    throw new Error(
      "OLIST_TOKEN_ENCRYPTION_KEY precisa conter exatamente 32 bytes.",
    );
  }

  return key;
}

function encryptToken(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const authenticationTag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64url"),
    authenticationTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

function decryptToken(value) {
  const [version, ivValue, authenticationTagValue, ciphertextValue] =
    value.split(".");

  if (
    version !== "v1" ||
    !ivValue ||
    !authenticationTagValue ||
    !ciphertextValue
  ) {
    throw new Error("Token Olist criptografado possui formato invalido.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(authenticationTagValue, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function tokenExpiration(seconds, fallbackSeconds) {
  const parsedSeconds = Number(seconds);
  const validSeconds =
    Number.isFinite(parsedSeconds) && parsedSeconds > 0
      ? parsedSeconds
      : fallbackSeconds;

  return new Date(Date.now() + validSeconds * 1000);
}

async function requestTokens(parameters) {
  const configuration = getConfiguration();
  const body = new URLSearchParams({
    client_id: configuration.clientId,
    client_secret: configuration.clientSecret,
    ...parameters,
  });

  const response = await fetch(configuration.tokenUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(15000),
  });

  const responseText = await response.text();
  let responseData = null;

  try {
    responseData = responseText ? JSON.parse(responseText) : null;
  } catch {
    responseData = null;
  }

  if (!response.ok) {
    const error = new Error(
      `Olist recusou a solicitacao de token com HTTP ${response.status}.`,
    );
    error.status = response.status;
    throw error;
  }

  if (!responseData?.access_token) {
    throw new Error("Olist nao devolveu access_token.");
  }

  return responseData;
}

export function isOlistConfigured() {
  try {
    if (!REQUIRED_CONFIGURATION.every((name) => process.env[name]?.trim())) {
      return false;
    }

    getConfiguration();
    getEncryptionKey();
    return true;
  } catch {
    return false;
  }
}

export async function createOlistOAuthState(shop) {
  const now = new Date();
  const state = randomBytes(32).toString("base64url");

  await db.olistOAuthState.deleteMany({
    where: {
      expiresAt: {
        lt: now,
      },
    },
  });

  await db.olistOAuthState.create({
    data: {
      state,
      shop,
      expiresAt: new Date(now.getTime() + OAUTH_STATE_TTL_MS),
    },
  });

  return state;
}

export function createOlistAuthorizationUrl(state) {
  const configuration = getConfiguration();
  const authorizationUrl = new URL(configuration.authorizationUrl);

  authorizationUrl.searchParams.set("client_id", configuration.clientId);
  authorizationUrl.searchParams.set("redirect_uri", configuration.redirectUri);
  authorizationUrl.searchParams.set("scope", "openid");
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("state", state);

  return authorizationUrl.toString();
}

export async function consumeOlistOAuthState(state) {
  const record = await db.olistOAuthState.findUnique({
    where: {
      state,
    },
  });

  if (!record || record.expiresAt <= new Date()) {
    if (record) {
      await db.olistOAuthState.delete({
        where: {
          state,
        },
      });
    }

    throw new Error("Estado OAuth do Olist ausente ou expirado.");
  }

  await db.olistOAuthState.delete({
    where: {
      state,
    },
  });

  return record.shop;
}

export async function exchangeOlistAuthorizationCode(code) {
  const configuration = getConfiguration();

  return requestTokens({
    grant_type: "authorization_code",
    redirect_uri: configuration.redirectUri,
    code,
  });
}

export async function saveOlistTokens(
  shop,
  tokenData,
  previousRefreshToken = null,
) {
  const refreshToken = tokenData.refresh_token || previousRefreshToken;

  if (!refreshToken) {
    throw new Error("Olist nao devolveu refresh_token.");
  }

  const data = {
    accessTokenCiphertext: encryptToken(tokenData.access_token),
    refreshTokenCiphertext: encryptToken(refreshToken),
    tokenType: tokenData.token_type || "Bearer",
    scope:
      typeof tokenData.scope === "string"
        ? tokenData.scope
        : Array.isArray(tokenData.scope)
          ? tokenData.scope.join(" ")
          : null,
    expiresAt: tokenExpiration(tokenData.expires_in, 4 * 60 * 60),
    refreshExpiresAt: tokenExpiration(
      tokenData.refresh_expires_in,
      365 * 24 * 60 * 60,
    ),
  };

  await db.olistConnection.upsert({
    where: {
      shop,
    },
    create: {
      shop,
      ...data,
    },
    update: data,
  });
}

export async function getOlistConnectionStatus(shop) {
  return db.olistConnection.findUnique({
    where: {
      shop,
    },
    select: {
      updatedAt: true,
      expiresAt: true,
      refreshExpiresAt: true,
    },
  });
}

export async function disconnectOlistConnection(shop) {
  return db.olistConnection.deleteMany({
    where: {
      shop,
    },
  });
}

export async function getOlistAccessToken(shop, { forceRefresh = false } = {}) {
  const connection = await db.olistConnection.findUnique({
    where: {
      shop,
    },
  });

  if (!connection) {
    throw new Error("Conta Olist ainda nao conectada.");
  }

  if (
    !forceRefresh &&
    connection.expiresAt.getTime() > Date.now() + TOKEN_REFRESH_MARGIN_MS
  ) {
    return decryptToken(connection.accessTokenCiphertext);
  }

  const currentRefreshToken = decryptToken(connection.refreshTokenCiphertext);
  const tokenData = await requestTokens({
    grant_type: "refresh_token",
    refresh_token: currentRefreshToken,
  });

  await saveOlistTokens(shop, tokenData, currentRefreshToken);

  return tokenData.access_token;
}
