import { authenticate } from "../shopify.server";

export class AppProxyShopError extends Error {
  constructor() {
    super("Não foi possível identificar a loja.");
    this.name = "AppProxyShopError";
    this.code = "SHOP_NOT_IDENTIFIED";
    this.status = 401;
  }
}

export async function authenticateAppProxyShop(request) {
  const { session } = await authenticate.public.appProxy(request);
  const shop =
    session?.shop || new URL(request.url).searchParams.get("shop")?.trim();

  if (!shop || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) {
    throw new AppProxyShopError();
  }

  return shop.toLowerCase();
}
