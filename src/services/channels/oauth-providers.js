// Registro central dos providers OAuth oficiais usados pelos adapters.
const GRAPH_VERSION = process.env.GRAPH_VERSION || "v21.0";

const OAUTH_PROVIDERS = Object.freeze({
  GOOGLE: {
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    extraAuthParams: { access_type: "offline", prompt: "consent" },
    usePkce: true,
    clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID",
    clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET",
    redirectUriEnv: "GOOGLE_OAUTH_REDIRECT_URI",
    scopesByChannel: Object.freeze({
      EMAIL: Object.freeze([
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.send",
      ]),
      GOOGLE_REVIEWS: Object.freeze(["https://www.googleapis.com/auth/business.manage"]),
    }),
  },
  META: {
    authorizationUrl: `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`,
    tokenUrl: `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`,
    extraAuthParams: {},
    clientIdEnv: "META_APP_ID",
    clientSecretEnv: "META_APP_SECRET",
    redirectUriEnv: "META_OAUTH_REDIRECT_URI",
    scopesByChannel: Object.freeze({
      FACEBOOK_MESSENGER: Object.freeze(["pages_show_list", "pages_manage_metadata", "pages_messaging"]),
      FACEBOOK_COMMENTS: Object.freeze(["pages_show_list", "pages_manage_metadata", "pages_read_engagement", "pages_manage_engagement"]),
      INSTAGRAM_DIRECT: Object.freeze(["pages_show_list", "pages_manage_metadata", "pages_messaging", "instagram_basic", "instagram_manage_messages"]),
      INSTAGRAM_COMMENTS: Object.freeze(["pages_show_list", "pages_manage_metadata", "pages_read_engagement", "pages_manage_engagement", "instagram_basic", "instagram_manage_comments"]),
    }),
  },
  MICROSOFT: {
    authorizationUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    extraAuthParams: {},
    clientIdEnv: "MICROSOFT_OAUTH_CLIENT_ID",
    clientSecretEnv: "MICROSOFT_OAUTH_CLIENT_SECRET",
    redirectUriEnv: "MICROSOFT_OAUTH_REDIRECT_URI",
    defaultScopes: ["offline_access", "Mail.Read", "Mail.Send", "User.Read"],
  },
  AMAZON: {
    authorizationUrl: `${process.env.AMAZON_SELLER_CENTRAL_URL || "https://sellercentral.amazon.com.br"}/apps/authorize/consent`,
    authorizationClientIdParam: "application_id",
    includeRedirectUriInAuthorization: false,
    includeResponseTypeInAuthorization: false,
    tokenUrl: "https://api.amazon.com/auth/o2/token",
    extraAuthParams: {},
    clientIdEnv: "AMAZON_SPAPI_APPLICATION_ID",
    tokenClientIdEnv: "AMAZON_LWA_CLIENT_ID",
    clientSecretEnv: "AMAZON_LWA_CLIENT_SECRET",
    redirectUriEnv: "AMAZON_OAUTH_REDIRECT_URI",
    defaultScopes: [],
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

function getOAuthScopes(name, channel) {
  const provider = getOAuthProvider(name);
  return [...(provider.scopesByChannel?.[channel] || provider.defaultScopes || [])];
}

module.exports = { OAUTH_PROVIDERS, getOAuthProvider, getOAuthScopes };
