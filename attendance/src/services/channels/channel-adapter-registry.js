// Fábrica de adapters — único lugar que sabe mapear Channel -> classe
// concreta. A Central/Bot nunca instanciam um adapter específico direto.
const { MetaAdapter } = require("./meta-adapter");
const {
  FacebookMessengerAdapter, InstagramDirectAdapter, FacebookCommentsAdapter, InstagramCommentsAdapter,
} = require("./meta-messaging-adapter");
const { EmailAdapter } = require("./email-adapter");
const { MercadoLivreAdapter } = require("./mercado-livre-adapter");
const { TikTokShopAdapter } = require("./tiktok-shop-adapter");
const { AmazonAdapter } = require("./amazon-adapter");
const { ShopeeAdapter } = require("./shopee-adapter");
const { GoogleReviewsAdapter } = require("./google-reviews-adapter");
const { ReclameAquiAdapter } = require("./reclame-aqui-adapter");

const ADAPTER_CLASSES = Object.freeze({
  META: MetaAdapter,
  // Cada sub-canal Meta "novo" tem sua própria classe (item 19) — antes
  // todas as 4 caíam na mesma MetaAdapter do WhatsApp, que declarava
  // capabilities completas sem nenhuma chamada real por trás.
  INSTAGRAM_DIRECT: InstagramDirectAdapter,
  INSTAGRAM_COMMENTS: InstagramCommentsAdapter,
  FACEBOOK_MESSENGER: FacebookMessengerAdapter,
  FACEBOOK_COMMENTS: FacebookCommentsAdapter,
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
