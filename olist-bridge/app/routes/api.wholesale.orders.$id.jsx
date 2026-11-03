import {
  wholesaleErrorResponse,
  wholesaleJson,
  wholesaleOptionsResponse,
} from "../services/wholesale-api-response.server";
import { requireWholesaleCustomer } from "../services/wholesale-customer-auth.server";
import { getWholesaleOrder } from "../services/wholesale-order-read.server";

export async function loader({ request, params }) {
  if (request.method === "OPTIONS") return wholesaleOptionsResponse();

  try {
    const { shop, companyIds } = await requireWholesaleCustomer(request);
    const order = await getWholesaleOrder({
      shop,
      companyIds,
      orderId: params.id,
    });

    if (!order) {
      return wholesaleJson(
        {
          success: false,
          code: "WHOLESALE_ORDER_NOT_FOUND",
          message: "Pedido nao encontrado.",
        },
        { status: 404 },
      );
    }

    return wholesaleJson({ success: true, order });
  } catch (error) {
    return wholesaleErrorResponse(error);
  }
}
