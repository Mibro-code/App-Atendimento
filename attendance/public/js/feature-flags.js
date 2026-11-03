(() => {
  const marketplaceChannels = Object.freeze([
    "MERCADO_LIVRE",
    "TIKTOK_SHOP",
    "AMAZON_MARKETPLACE",
    "SHOPEE",
    "SHEIN_MARKETPLACE",
  ]);

  window.MIBRO_FEATURES = Object.freeze({
    // Reative aqui para devolver todas as telas e opções sem restaurar código.
    marketplaces: false,
    marketplaceChannels,
  });

  window.isMarketplaceFeatureChannel = (channel) => marketplaceChannels.includes(String(channel || ""));
})();