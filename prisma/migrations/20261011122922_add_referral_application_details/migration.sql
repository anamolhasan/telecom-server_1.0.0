-- CreateEnum
CREATE TYPE "ReferralPromotionMethod" AS ENUM ('SOCIAL_MEDIA', 'MESSAGING_APPS', 'FRIENDS_FAMILY', 'COMMUNITY_GROUP', 'OTHER');

-- AlterTable
ALTER TABLE "referral_applications" ADD COLUMN     "promotionMethod" "ReferralPromotionMethod",
ADD COLUMN     "promotionUrl" TEXT,
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "termsAccepted" BOOLEAN NOT NULL DEFAULT false;
