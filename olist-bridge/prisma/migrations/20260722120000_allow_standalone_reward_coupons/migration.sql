-- Reward coupons can be granted directly to a customer, without a referral.
ALTER TABLE "RewardCoupon"
ALTER COLUMN "referralUseId" DROP NOT NULL;
