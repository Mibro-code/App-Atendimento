import db from "../db.server";
import {
  createReferralCouponForCustomer,
  getReferralCustomer,
} from "../services/referral-coupon.server";
import {
  authenticate,
  unauthenticated,
} from "../shopify.server";

// 28/07/2026 às 23:50 em America/Sao_Paulo (UTC-3).
const REFERRAL_CAMPAIGN_ENDS_AT = new Date(
  "2026-07-29T02:50:00.000Z",
);

function isReferralCampaignActive(now = new Date()) {
  return now < REFERRAL_CAMPAIGN_ENDS_AT;
}

export const loader = async ({request}) => {
  // Responde ao preflight CORS enviado pela extensão
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "Authorization, Content-Type",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      },
    });
  }

  const {sessionToken} =
    await authenticate.public.customerAccount(request);

  const shop = sessionToken.dest;
  const customerId = sessionToken.sub;

  if (!customerId) {
    return Response.json(
      {
        success: false,
        message: "Cliente não autenticado.",
      },
      {
        status: 401,
        headers: {
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  }

  const [referralCoupon, rewardRows] = await Promise.all([
    db.referralCoupon.findUnique({
      where: {
        shop_customerId: {
          shop,
          customerId,
        },
      },
    }),
    db.rewardCoupon.findMany({
      where: {
        shop,
        ownerCustomerId: customerId,
      },
      orderBy: {
        createdAt: "desc",
      },
    }),
  ]);

  const now = new Date();
  const campaignActive = isReferralCampaignActive(now);

  const rewards = rewardRows.map((reward) => {
      let status = reward.status;

      if (
        status === "ACTIVE" &&
        reward.endsAt &&
        new Date(reward.endsAt) < now
      ) {
        status = "EXPIRED";
      }

      if (
        reward.usageCount >= reward.usageLimit ||
        reward.usedAt
      ) {
        status = "USED";
      }

      return {
        id: reward.id,
        code: reward.code,
        status,
        usageLimit: reward.usageLimit,
        usageCount: reward.usageCount,
        startsAt: reward.startsAt,
        endsAt: reward.endsAt,
        usedAt: reward.usedAt,
      };
    });

  return Response.json(
    {
      success: true,
      campaignActive,
      campaignEndsAt: REFERRAL_CAMPAIGN_ENDS_AT.toISOString(),

      referralCoupon: referralCoupon
        ? {
            code: referralCoupon.code,
            status: referralCoupon.status,
            totalUses: referralCoupon.totalUses,
            startsAt: referralCoupon.startsAt,
            endsAt: referralCoupon.endsAt,
          }
        : null,

      rewards,

      statistics: {
        totalReferrals: referralCoupon?.totalUses ?? 0,

        availableRewards: rewards.filter(
          (reward) => reward.status === "ACTIVE",
        ).length,

        usedRewards: rewards.filter(
          (reward) => reward.status === "USED",
        ).length,
      },
    },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
};
export const action = async ({request}) => {
  if (request.method !== "POST") {
    return Response.json(
      {
        success: false,
        message: "Método não permitido.",
      },
      {
        status: 405,
        headers: {
          "Access-Control-Allow-Origin": "*",
          Allow: "POST",
        },
      },
    );
  }

  let applyCors = (response) => response;

  try {
    const {sessionToken, cors} =
      await authenticate.public.customerAccount(request);

    applyCors = cors;

    const shop = sessionToken?.dest;
    const customerId = sessionToken?.sub;

    if (!shop || !customerId) {
      return applyCors(
        Response.json(
          {
            success: false,
            message: "Cliente não autenticado.",
          },
          {
            status: 401,
          },
        ),
      );
    }

    if (!isReferralCampaignActive()) {
      return applyCors(
        Response.json(
          {
            success: false,
            message:
              "A campanha Indique e Ganhe foi encerrada. Não é mais possível criar cupons de indicação.",
          },
          {status: 410},
        ),
      );
    }

    const {admin} = await unauthenticated.admin(shop);

    const customer = await getReferralCustomer({
      admin,
      customerId,
    });

    const {created, coupon} =
      await createReferralCouponForCustomer({
        admin,
        shop,
        customer,
      });

    return applyCors(
      Response.json(
        {
          success: true,
          created,
          code: coupon.code,
        },
        {
          status: created ? 201 : 200,
        },
      ),
    );
  } catch (error) {
    console.error(
      "Erro ao gerar cupom pelo cliente:",
      error,
    );

    return applyCors(
      Response.json(
        {
          success: false,
          message:
            "Não foi possível gerar o cupom. Tente novamente em alguns minutos.",
        },
        {
          status: 500,
          headers: {
            "Access-Control-Allow-Origin": "*",
          },
        },
      ),
    );
  }
};
