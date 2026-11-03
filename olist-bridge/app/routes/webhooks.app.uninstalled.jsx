import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    await db.$transaction([
      db.olistOAuthState.deleteMany({ where: { shop } }),
      db.olistConnection.deleteMany({ where: { shop } }),
      db.wholesaleQuote.deleteMany({ where: { shop } }),
      db.wholesaleSettings.deleteMany({ where: { shop } }),
      db.referralCoupon.deleteMany({ where: { shop } }),
      db.couponSettings.deleteMany({ where: { shop } }),
      db.centralLinkSettings.deleteMany({ where: { shop } }),
      db.appearanceSettings.deleteMany({ where: { shop } }),
      db.session.deleteMany({ where: { shop } }),
    ]);
  } catch (error) {
    console.error(`Failed to remove data for uninstalled shop ${shop}`, error);

    return new Response(null, { status: 500 });
  }

  return new Response(null, { status: 200 });
};
