import { handleCrmBridge } from "../services/crm-bridge-http.server";
import { resolveBridgeShop } from "../services/crm-order-bridge.server";
import { findCrmProposal } from "../services/crm-proposal-bridge.server";

// CRM -> procura proposta criada numa tentativa que caiu (referência do CRM na observação).
export async function action({ request }) {
  return handleCrmBridge(request, async ({ body, brand }) => {
    const shop = await resolveBridgeShop();
    return findCrmProposal(shop, body, brand);
  });
}
