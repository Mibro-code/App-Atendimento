import crypto from "node:crypto";
import { Buffer } from "node:buffer";
import process from "node:process";

import { syncApprovedWholesaleOrders } from "../services/olist-approved-orders-sync.server";

function authorized(request) {
  const expected = String(process.env.CRM_SHOPIFY_SHARED_SECRET || "").trim();
  const authorization = String(request.headers.get("authorization") || "");
  const provided = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
  if (!expected || !provided) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return (
    expectedBuffer.length === providedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, providedBuffer)
  );
}

export async function action({ request }) {
  if (request.method !== "POST") {
    return Response.json(
      { success: false, code: "METHOD_NOT_ALLOWED" },
      { status: 405, headers: { Allow: "POST" } },
    );
  }
  if (!authorized(request)) {
    return Response.json(
      { success: false, code: "UNAUTHORIZED" },
      { status: 401 },
    );
  }

  const result = await syncApprovedWholesaleOrders();
  return Response.json(
    { success: result.failed === 0, ...result },
    { status: result.failed === 0 ? 200 : 207 },
  );
}
