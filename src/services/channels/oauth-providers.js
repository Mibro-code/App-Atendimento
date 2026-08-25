// Registro de endpoints OAuth por provider (item 13) — só entram aqui
// endpoints públicos, estáveis e documentados oficialmente. Providers sem um
// endpoint confirmado ficam de fora (o adapter correspondente trata a
// autorização de outra forma ou fica NOT_IMPLEMENTED/aguardando acesso).
const OAUTH_PROVIDERS = Object.freeze({
  GOOGLE: {
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    extraAuthParams: { access_type: "offline", prompt: "consent" },
    clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID",
    clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET",
    redirectUriEnv: "GOOGLE_OAUTH_REDIRECT_URI",
    defaultScopes: ["https://www.googleapis.com/auth/business.manage"],
  },
  MICROSOFT: {
    authorizationUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    extraAuthParams: {},
    clientIdEnv: "MICROSOFT_OAUTH_CLIENT_ID",
    clientSecretEnv: "MICROSOFT_OAUTH_CLIENT_SECRET",
    redirectUriEnv: "MICROSOFT_OAUTH_REDIRECT_URI",
    defaultScopes: ["offline_access", "Mail.Read", "Mail.Send"],
  },
  MERCADO_LIVRE: {
    authorizationUrl: "https://auth.mercadolivre.com.br/authorization",
    tokenUrl: "https://api.mercadolibre.com/oauth/token",
    extraAuthParams: {},
    clientIdEnv: "MERCADO_LIVRE_CLIENT_ID",
    clientSecretEnv: "MERCADO_LIVRE_CLIENT_SECRET",
    redirectUriEnv: "MERCADO_LIVRE_OAUTH_REDIRECT_URI",
    defaultScopes: [],
  },
});

function getOAuthProvider(name) {
  const provider = OAUTH_PROVIDERS[name];
  if (!provider) throw Object.assign(new Error(`Provider OAuth "${name}" não está preparado.`), { statusCode: 400 });
  return provider;
}

module.exports = { OAUTH_PROVIDERS, getOAuthProvider };
