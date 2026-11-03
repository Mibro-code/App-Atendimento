const SUPPORTED_TIERS = new Set(["tier1", "tier2", "tier3"]);

const CATALOGS = {
  mibro: {
    "A3-DARK-GRAY": { model: "Mibro A3", tier1: 37500, tier2: 34500, tier3: 32500 },
    "A3-MOCHA": { model: "Mibro A3", tier1: 37500, tier2: 34500, tier3: 32500 },
    "C4-BLACK": { model: "Mibro C4", tier1: 27000, tier2: 25000, tier3: 23500 },
    "C4-SILVER": { model: "Mibro C4", tier1: 27000, tier2: 25000, tier3: 23500 },
    "GS-ACTIVE-BLACK": { model: "Mibro GS Active", tier1: 41000, tier2: 38000, tier3: 36000 },
    "GS-ACTIVE2-DARK-GRAY": { model: "Mibro GS Active 2", tier1: 56000, tier2: 52000, tier3: 49500 },
    "GS-ACTIVE2-LIGHT-PURPLE": { model: "Mibro GS Active 2", tier1: 56000, tier2: 52000, tier3: 49500 },
    "GS-PRO-BLACK": { model: "Mibro GS Pro", tier1: 48500, tier2: 45000, tier3: 42500 },
    "GS-PRO2-DARK-GRAY": { model: "Mibro GS Pro 2", tier1: 71000, tier2: 66000, tier3: 62500 },
    "GS-PRO2-WHITE": { model: "Mibro GS Pro 2", tier1: 71000, tier2: 66000, tier3: 62500 },
    "LITE3-DARK-GRAY": { model: "Mibro Lite 3", tier1: 39000, tier2: 36000, tier3: 34000 },
    "LITE3-LIGHT-GOLD": { model: "Mibro Lite 3", tier1: 39000, tier2: 36000, tier3: 34000 },
    "LITE3-PRO-BLACKISH-GREEN": { model: "Mibro Lite 3 Pro", tier1: 54000, tier2: 50000, tier3: 47500 },
    "LITE3-PRO-KHAKIO-GRAY": { model: "Mibro Lite 3 Pro", tier1: 54000, tier2: 50000, tier3: 47500 },
    "LITE3-PRO-ROSE-GOLD": { model: "Mibro Lite 3 Pro", tier1: 54000, tier2: 50000, tier3: 47500 },
  },
  sincrofit: {
    "TITAN-PRO-PRATA": { model: "Titan Pro", tier1: 41000, tier2: 38000 },
    "TITAN-PRO-PRETO": { model: "Titan Pro", tier1: 41000, tier2: 38000 },
    "MOTION-GPS-PRATA": { model: "Motion GPS", tier1: 29000, tier2: 26000 },
    "MOTION-GPS-PRETO": { model: "Motion GPS", tier1: 29000, tier2: 26000 },
    "MOTION-GPS-DOURADO": { model: "Motion GPS", tier1: 29000, tier2: 26000 },
    "NEO-ROSA": { model: "Neo", tier1: 21000, tier2: 18800 },
    "NEO-PRETO": { model: "Neo", tier1: 21000, tier2: 18800 },
  },
};

export class WholesalePricingError extends Error {
  constructor(message, { code, status = 422, details } = {}) {
    super(message);
    this.name = "WholesalePricingError";
    this.code = code || "WHOLESALE_PRICING_ERROR";
    this.status = status;
    this.details = details;
  }
}

export function normalizeWholesaleBrand(value) {
  const brand = String(value || "").trim().toLowerCase();
  return CATALOGS[brand] ? brand : "mibro";
}

export function getWholesaleCatalog(brand) {
  return CATALOGS[normalizeWholesaleBrand(brand)];
}

export function wholesaleTierForQuantity(quantity, minimumQuantity = 10) {
  if (quantity >= 100) return "tier3";
  if (quantity >= 50) return "tier2";
  if (quantity >= minimumQuantity) return "tier1";
  return null;
}

export function isManualTierSelection(selectedTier, manualTierApplied) {
  return manualTierApplied === true || SUPPORTED_TIERS.has(selectedTier);
}

export function resolveWholesalePrice({
  brand,
  sku,
  quantity,
  automaticQuantity = quantity,
  selectedTier = "auto",
  manualTierApplied = false,
  frontendUnitPrice,
  minimumQuantity = 10,
}) {
  const normalizedBrand = normalizeWholesaleBrand(brand);
  const normalizedSku = String(sku || "").trim().toUpperCase();
  const normalizedSelection = String(selectedTier || "auto").trim().toLowerCase();
  const catalogItem = CATALOGS[normalizedBrand][normalizedSku];

  if (!catalogItem) {
    throw new WholesalePricingError(
      `O SKU ${normalizedSku || "informado"} não está cadastrado na tabela de atacado do servidor.`,
      { code: "WHOLESALE_SKU_NOT_CONFIGURED" },
    );
  }

  const automaticTier = wholesaleTierForQuantity(
    automaticQuantity,
    minimumQuantity,
  );
  const manualOverride = isManualTierSelection(
    normalizedSelection,
    manualTierApplied,
  );

  if (manualOverride && !SUPPORTED_TIERS.has(normalizedSelection)) {
    throw new WholesalePricingError("A faixa manual informada é inválida.", {
      code: "INVALID_PRICE_TIER",
    });
  }

  const appliedTier = manualOverride ? normalizedSelection : automaticTier;
  const officialPrice = appliedTier ? catalogItem[appliedTier] : null;

  if (!officialPrice) {
    throw new WholesalePricingError(
      `A faixa ${appliedTier || "mínima"} não está configurada para ${normalizedSku}.`,
      {
        code: "PRICE_TIER_NOT_CONFIGURED",
        details: { brand: normalizedBrand, sku: normalizedSku, selected_tier: appliedTier },
      },
    );
  }

  if (manualOverride && Number(frontendUnitPrice) !== officialPrice) {
    throw new WholesalePricingError(
      `O preço enviado para ${normalizedSku} não corresponde à faixa ${appliedTier}.`,
      {
        code: "WHOLESALE_PRICE_MISMATCH",
        details: {
          brand: normalizedBrand,
          sku: normalizedSku,
          quantity,
          selected_tier: appliedTier,
          expected_unit_price: officialPrice,
          received_unit_price: Number(frontendUnitPrice),
        },
      },
    );
  }

  return {
    unitPriceCents: officialPrice,
    appliedTier,
    automaticTier,
    pricingMode: manualOverride ? "manual_tier" : "automatic",
    manualOverride,
    model: catalogItem.model,
  };
}
