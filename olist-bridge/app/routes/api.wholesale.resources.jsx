import {
  wholesaleErrorResponse,
  wholesaleJson,
  wholesaleOptionsResponse,
} from "../services/wholesale-api-response.server";
import { requireWholesaleCustomer } from "../services/wholesale-customer-auth.server";
import { listWholesaleResources } from "../services/wholesale-profile-read.server";

export async function loader({ request }) {
  if (request.method === "OPTIONS") return wholesaleOptionsResponse();

  try {
    const { shop, companyIds, customer } = await requireWholesaleCustomer(request);
    const resources = await listWholesaleResources({
      shop,
      companyIds,
      customerId: customer.id,
    });
    return wholesaleJson({ success: true, resources });
  } catch (error) {
    return wholesaleErrorResponse(error);
  }
}
