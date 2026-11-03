import {
  wholesaleErrorResponse,
  wholesaleJson,
  wholesaleOptionsResponse,
} from "../services/wholesale-api-response.server";
import { requireWholesaleCustomer } from "../services/wholesale-customer-auth.server";
import { listWholesaleOrders } from "../services/wholesale-order-read.server";

export async function loader({ request }) {
  if (request.method === "OPTIONS") return wholesaleOptionsResponse();

  try {
    const { shop, companyIds } = await requireWholesaleCustomer(request);
    const url = new URL(request.url);
    const status = url.searchParams.get("status")?.trim() || undefined;
    const limit = url.searchParams.get("limit") || 50;
    const orders = await listWholesaleOrders({
      shop,
      companyIds,
      status,
      limit,
    });

    return wholesaleJson({ success: true, orders });
  } catch (error) {
    return wholesaleErrorResponse(error);
  }
}
