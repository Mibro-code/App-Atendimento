import db from "../db.server";

const CNPJ_DATA_LEVELS = new Set(["verify", "essential", "complete"]);

function normalizeCnpjDataLevel(value) {
  return CNPJ_DATA_LEVELS.has(value) ? value : "complete";
}

export class WholesaleTestModeError extends Error {
  constructor() {
    super(
      "O modo teste está ativo. Desative-o no admin Shopify para criar pedidos.",
    );
    this.name = "WholesaleTestModeError";
    this.code = "WHOLESALE_TEST_MODE_ACTIVE";
    this.status = 409;
  }
}

export async function getWholesaleMode(shop) {
  const settings = await db.wholesaleSettings.findUnique({
    where: { shop },
    select: {
      testModeEnabled: true,
      cnpjDataLevel: true,
      updatedAt: true,
    },
  });

  return {
    testModeEnabled: settings?.testModeEnabled ?? true,
    cnpjDataLevel: normalizeCnpjDataLevel(settings?.cnpjDataLevel),
    updatedAt: settings?.updatedAt ?? null,
  };
}

export async function setWholesaleTestMode(shop, testModeEnabled) {
  const settings = await db.wholesaleSettings.upsert({
    where: { shop },
    create: {
      shop,
      testModeEnabled,
    },
    update: {
      testModeEnabled,
    },
    select: {
      testModeEnabled: true,
      cnpjDataLevel: true,
      updatedAt: true,
    },
  });

  return settings;
}

export async function setWholesaleCnpjDataLevel(shop, cnpjDataLevel) {
  const normalizedLevel = normalizeCnpjDataLevel(cnpjDataLevel);
  const settings = await db.wholesaleSettings.upsert({
    where: { shop },
    create: {
      shop,
      cnpjDataLevel: normalizedLevel,
    },
    update: {
      cnpjDataLevel: normalizedLevel,
    },
    select: {
      testModeEnabled: true,
      cnpjDataLevel: true,
      updatedAt: true,
    },
  });

  return settings;
}
export async function assertWholesaleOrderCreationAllowed(shop) {
  const mode = await getWholesaleMode(shop);

  if (mode.testModeEnabled) {
    throw new WholesaleTestModeError();
  }

  return mode;
}
