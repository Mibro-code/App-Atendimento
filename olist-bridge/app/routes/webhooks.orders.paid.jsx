import db from "../db.server";
import { authenticate } from "../shopify.server";

function normalizeCustomerId(customerId) {
  if (!customerId) return null;

  const value = String(customerId);

  if (value.startsWith("gid://shopify/Customer/")) {
    return value;
  }

  return `gid://shopify/Customer/${value}`;
}

function generateRewardCode(customerName) {
  const cleanName = String(customerName || "CLIENTE")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
    .slice(0, 12);

  const randomPart = Math.random()
    .toString(36)
    .substring(2, 8)
    .toUpperCase();

  return `RECOMPENSA-${cleanName}-${randomPart}`;
}

export const action = async ({ request }) => {
  const { topic, shop, payload, admin, session } =
    await authenticate.webhook(request);

  console.log(`Webhook recebido: ${topic} — ${shop}`);
  console.log(`Pedido: ${payload?.name || payload?.id}`);

  if (!session || !admin) {
    console.log("Sessão administrativa não encontrada.");

    return new Response(null, {
      status: 200,
    });
  }

  try {
    const discountCodes = Array.isArray(payload?.discount_codes)
      ? payload.discount_codes
      : [];
const rewardDiscount = discountCodes.find((discount) =>
  String(discount?.code || "")
    .toUpperCase()
    .startsWith("RECOMPENSA-"),
);

if (rewardDiscount) {
  const rewardCode = String(
    rewardDiscount.code,
  ).toUpperCase();

  const rewardCoupon =
    await db.rewardCoupon.findUnique({
      where: {
        shop_code: {
          shop,
          code: rewardCode,
        },
      },
    });

  if (!rewardCoupon) {
    console.log(
      `Recompensa ${rewardCode} não encontrada no banco.`,
    );

    return new Response(null, {
      status: 200,
    });
  }

  if (
    rewardCoupon.status === "USED" ||
    rewardCoupon.usedAt
  ) {
    console.log(
      `Recompensa ${rewardCode} já estava marcada como utilizada.`,
    );

    return new Response(null, {
      status: 200,
    });
  }

  await db.rewardCoupon.update({
    where: {
      id: rewardCoupon.id,
    },

    data: {
      status: "USED",
      usageCount: {
        increment: 1,
      },
      usedAt: new Date(),
    },
  });

  console.log(
    `Recompensa utilizada: ${rewardCode}`,
  );

  return new Response(null, {
    status: 200,
  });
}

    const referralDiscount = discountCodes.find((discount) =>
      String(discount?.code || "")
        .toUpperCase()
        .startsWith("INDICA-"),
    );

    if (!referralDiscount) {
      console.log("Pedido sem cupom de indicação.");

      return new Response(null, {
        status: 200,
      });
    }

    const referralCode = String(
      referralDiscount.code,
    ).toUpperCase();

    console.log(
      `Cupom de indicação encontrado: ${referralCode}`,
    );

    const referralCoupon =
      await db.referralCoupon.findUnique({
        where: {
          shop_code: {
            shop,
            code: referralCode,
          },
        },
      });

    if (!referralCoupon) {
      console.log(
        `Cupom ${referralCode} não encontrado no banco.`,
      );

      return new Response(null, {
        status: 200,
      });
    }

    const orderId = String(payload.id);

    const buyerCustomerId = normalizeCustomerId(
      payload?.customer?.id,
    );

    const buyerEmail =
      payload?.email ||
      payload?.contact_email ||
      payload?.customer?.email ||
      null;

    const settings =
      await db.couponSettings.findUnique({
        where: {
          shop,
        },
      });

    if (
      settings?.preventSelfReferral &&
      buyerCustomerId &&
      buyerCustomerId === referralCoupon.customerId
    ) {
      console.log(
        `Autoindicação bloqueada no pedido ${payload.name}.`,
      );

      await db.referralUse.upsert({
        where: {
          shop_orderId: {
            shop,
            orderId,
          },
        },

        create: {
          shop,
          referralCouponId: referralCoupon.id,
          orderId,
          orderName: payload.name || null,
          buyerCustomerId,
          buyerEmail,
          orderTotal: payload.total_price
            ? Number(payload.total_price)
            : null,
          currencyCode:
            payload.currency ||
            payload.presentment_currency ||
            null,
          status: "REJECTED_SELF_REFERRAL",
          paidAt: payload.processed_at
            ? new Date(payload.processed_at)
            : new Date(),
          validatedAt: new Date(),
        },

        update: {
          status: "REJECTED_SELF_REFERRAL",
          validatedAt: new Date(),
        },
      });

      return new Response(null, {
        status: 200,
      });
    }

    let referralUse =
      await db.referralUse.findUnique({
        where: {
          shop_orderId: {
            shop,
            orderId,
          },
        },

        include: {
          reward: true,
        },
      });

    if (referralUse?.reward) {
      console.log(
        `Pedido já processado. Recompensa existente: ${referralUse.reward.code}`,
      );

      return new Response(null, {
        status: 200,
      });
    }

    if (!referralUse) {
      referralUse = await db.referralUse.create({
        data: {
          shop,
          referralCouponId: referralCoupon.id,
          orderId,
          orderName: payload.name || null,
          buyerCustomerId,
          buyerEmail,
          orderTotal: payload.total_price
            ? Number(payload.total_price)
            : null,
          currencyCode:
            payload.currency ||
            payload.presentment_currency ||
            null,
          status: "VALIDATED",
          paidAt: payload.processed_at
            ? new Date(payload.processed_at)
            : new Date(),
          validatedAt: new Date(),
        },
      });

      await db.referralCoupon.update({
        where: {
          id: referralCoupon.id,
        },

        data: {
          totalUses: {
            increment: 1,
          },
        },
      });
    }

    if (
      !referralCoupon.customerId.startsWith(
        "gid://shopify/Customer/",
      )
    ) {
      console.log(
        "O cupom pertence a um cliente manual antigo. A recompensa não pode ser vinculada.",
      );

      return new Response(null, {
        status: 200,
      });
    }

    const rewardValue =
      settings?.rewardDiscountValue ?? 10;

    const rewardDurationDays =
      settings?.rewardDurationDays ?? 30;

    const rewardMinimumPurchase =
      settings?.rewardMinimumPurchase ?? 0;

    const rewardUsageLimit =
      settings?.rewardUsageLimit ?? 1;

    const startsAt = new Date();
    const endsAt = new Date();

    endsAt.setDate(
      endsAt.getDate() + rewardDurationDays,
    );

    const rewardCode = generateRewardCode(
      referralCoupon.customerName,
    );

    const discountValue =
      settings?.rewardDiscountType === "FIXED_AMOUNT"
        ? {
            discountAmount: {
              amount: String(rewardValue),
              appliesOnEachItem: false,
            },
          }
        : {
            percentage: rewardValue / 100,
          };

    const discountResponse = await admin.graphql(
      `#graphql
        mutation CreateRewardDiscount(
          $basicCodeDiscount: DiscountCodeBasicInput!
        ) {
          discountCodeBasicCreate(
            basicCodeDiscount: $basicCodeDiscount
          ) {
            codeDiscountNode {
              id
            }

            userErrors {
              field
              message
            }
          }
        }
      `,
      {
        variables: {
          basicCodeDiscount: {
            title:
              `Recompensa de ${referralCoupon.customerName || "cliente"}`,

            code: rewardCode,

            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),

            context: {
              customers: {
                add: [referralCoupon.customerId],
              },
            },

            customerGets: {
              value: discountValue,

              items: {
                all: true,
              },
            },

            minimumRequirement:
              rewardMinimumPurchase > 0
                ? {
                    subtotal: {
                      greaterThanOrEqualToSubtotal:
                        String(rewardMinimumPurchase),
                    },
                  }
                : undefined,

            appliesOncePerCustomer: true,
            usageLimit: rewardUsageLimit,

            combinesWith: {
              orderDiscounts:
                settings?.rewardCombinesOrderDiscount ??
                false,

              productDiscounts:
                settings?.rewardCombinesProductDiscount ??
                false,

              shippingDiscounts:
                settings?.rewardCombinesShipping ??
                false,
            },
          },
        },
      },
    );

    const discountJson =
      await discountResponse.json();

    const result =
      discountJson.data?.discountCodeBasicCreate;

    const userErrors = result?.userErrors ?? [];

    if (userErrors.length > 0) {
      console.error(
        "Erro da Shopify:",
        userErrors,
      );

      return new Response(null, {
        status: 500,
      });
    }

    const shopifyDiscountId =
      result?.codeDiscountNode?.id;

    if (!shopifyDiscountId) {
      console.error(
        "A Shopify não retornou o ID da recompensa.",
      );

      return new Response(null, {
        status: 500,
      });
    }

    await db.rewardCoupon.create({
      data: {
        shop,
        referralUseId: referralUse.id,
        ownerCustomerId:
          referralCoupon.customerId,
        ownerEmail:
          referralCoupon.customerEmail,
        code: rewardCode,
        shopifyDiscountId,
        status: "ACTIVE",
        usageLimit: rewardUsageLimit,
        startsAt,
        endsAt,
      },
    });

    console.log(
      `Indicação validada: ${referralCode}`,
    );

    console.log(
      `Recompensa criada: ${rewardCode}`,
    );

    console.log(
      `Indicador: ${
        referralCoupon.customerName ||
        referralCoupon.customerEmail
      }`,
    );

    return new Response(null, {
      status: 200,
    });
  } catch (error) {
    console.error(
      "Erro ao processar pedido e recompensa:",
      error,
    );

    return new Response(null, {
      status: 500,
    });
  }
};