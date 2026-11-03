import { handleCrmBridge } from "../services/crm-bridge-http.server";
import { resolveBridgeShop } from "../services/crm-order-bridge.server";
import { consultCrmOrder } from "../services/crm-proposal-bridge.server";

export async function action({ request }) {
  return handleCrmBridge(request, async ({ body, brand }) => consultCrmOrder(await resolveBridgeShop(), body, brand));
}
