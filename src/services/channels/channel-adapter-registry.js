// Fábrica de adapters — único lugar que sabe mapear Channel -> classe
// concreta. A Central/Bot nunca instanciam um adapter específico direto.
const { MetaAdapter } = require("./meta-adapter");
const { EmailAdapter } = require("./email-adapter");
const { MercadoLivreAdapter } = require("./mercado-livre-adapter");
const { TikTokShopAdapter } = require("./tiktok-shop-adapter");
const { AmazonAdapter } = require("./amazon-adapter");
const { ShopeeAdapter } = require("./shopee-adapter");
const { GoogleReviewsAdapter } = require("./google-reviews-adapter");
const { ReclameAquiAdapter } = require("./reclame-aqui-adapter");

const ADAPTER_CLASSES = Object.freeze({
  META: MetaAdapter,
  INSTAGRAM_DIRECT: MetaAdapter,
  INSTAGRAM_COMMENTS: MetaAdapter,
  FACEBOOK_MESSENGER: MetaAdapter,
  FACEBOOK_COMMENTS: MetaAdapter,
  EMAIL: EmailAdapter,
  MERCADO_LIVRE: MercadoLivreAdapter,
  TIKTOK_SHOP: TikTokShopAdapter,
  AMAZON_MARKETPLACE: AmazonAdapter,
  SHOPEE: ShopeeAdapter,
  GOOGLE_REVIEWS: GoogleReviewsAdapter,
  RECLAME_AQUI: ReclameAquiAdapter,
});

function getAdapterClass(channel) {
  return ADAPTER_CLASSES[channel] || null;
}

// `account` pode ser null para checagens estáticas de capabilities (ex.:
// mostrar no painel o que o canal suporta antes de qualquer conta existir).
function createAdapter(channel, account = null) {
  const AdapterClass = getAdapterClass(channel);
  if (!AdapterClass) return null;
  return new AdapterClass(account);
}

module.exports = { ADAPTER_CLASSES, createAdapter, getAdapterClass };
