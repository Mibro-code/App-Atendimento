import { handleCrmBridge } from "../services/crm-bridge-http.server";
import { getCrmPricingProfile, resolveBridgeShop } from "../services/crm-order-bridge.server";

// CRM -> histórico de pedidos aprovados no Olist (faixa por modelo x mix).
export async function action({ request }) {
  return handleCrmBridge(request, async ({ body }) => getCrmPricingProfile(await resolveBridgeShop(), body?.tax_id));
}
