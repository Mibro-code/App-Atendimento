import { handleCrmBridge } from "../services/crm-bridge-http.server";
import { resolveBridgeShop } from "../services/crm-order-bridge.server";
import { upsertCrmProposal } from "../services/crm-proposal-bridge.server";

// CRM -> cria ou atualiza a proposta comercial nativa (orçamento) no Olist.
export async function action({ request }) {
  return handleCrmBridge(request, async ({ body, brand }) => {
    const shop = await resolveBridgeShop();
    return upsertCrmProposal(shop, body, brand);
  });
}
