-- CreateEnum
CREATE TYPE "EarningProgram" AS ENUM ('AGENT', 'REFERRAL', 'AFFILIATE');

-- CreateEnum
CREATE TYPE "EarningStatus" AS ENUM ('PENDING', 'AVAILABLE', 'REVERSED');

-- CreateEnum
CREATE TYPE "EarningRuleType" AS ENUM ('FIXED', 'PERCENTAGE');

-- CreateEnum
CREATE TYPE "EarningRuleScope" AS ENUM ('PRODUCT', 'PRODUCT_VARIANT', 'OPERATOR_OFFER', 'GLOBAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WalletTransactionReason" ADD VALUE 'REFERRAL_MILESTONE';
ALTER TYPE "WalletTransactionReason" ADD VALUE 'AFFILIATE_COMMISSION';

-- CreateTable
CREATE TABLE "commission_rules" (
    "id" TEXT NOT NULL,
    "program" "EarningProgram" NOT NULL,
    "scope" "EarningRuleScope" NOT NULL,
    "ruleType" "EarningRuleType" NOT NULL,
    "value" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "productId" TEXT,
    "productVariantId" TEXT,
    "operatorOfferId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "note" VARCHAR(255),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "earning_transactions" (
    "id" TEXT NOT NULL,
    "program" "EarningProgram" NOT NULL,
    "status" "EarningStatus" NOT NULL DEFAULT 'PENDING',
    "appUserId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'bdt',
    "walletReason" "WalletTransactionReason" NOT NULL,
    "ruleType" "EarningRuleType" NOT NULL,
    "ruleValue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "ruleScope" "EarningRuleScope" NOT NULL,
    "ruleRefId" VARCHAR(64),
    "ruleSnapshot" JSONB,
    "commissionRuleId" TEXT,
    "baseAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "orderId" TEXT,
    "productOrderId" TEXT,
    "idempotencyKey" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "walletTransactionId" TEXT,
    "availableAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "earning_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_milestone_rewards" (
    "id" TEXT NOT NULL,
    "appUserId" TEXT NOT NULL,
    "status" "EarningStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'bdt',
    "qualifiedReferralCount" INTEGER NOT NULL,
    "requiredReferralCount" INTEGER NOT NULL,
    "configKey" VARCHAR(120) NOT NULL,
    "ruleSnapshot" JSONB,
    "earningTransactionId" TEXT,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "availableAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "referral_milestone_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_links" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "appUserId" TEXT NOT NULL,
    "productId" TEXT,
    "label" VARCHAR(150),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "affiliate_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_attributions" (
    "id" TEXT NOT NULL,
    "customerUserId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "affiliateLinkId" TEXT NOT NULL,
    "affiliateAppUserId" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "affiliate_attributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_conversions" (
    "id" TEXT NOT NULL,
    "affiliateAttributionId" TEXT NOT NULL,
    "productOrderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "affiliateAppUserId" TEXT NOT NULL,
    "status" "EarningStatus" NOT NULL DEFAULT 'PENDING',
    "orderAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'bdt',
    "earningTransactionId" TEXT,
    "convertedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "availableAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "affiliate_conversions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_commission_rule_program_scope_active" ON "commission_rules"("program", "scope", "isActive");

-- CreateIndex
CREATE INDEX "idx_commission_rule_productId" ON "commission_rules"("productId");

-- CreateIndex
CREATE INDEX "idx_commission_rule_variantId" ON "commission_rules"("productVariantId");

-- CreateIndex
CREATE INDEX "idx_commission_rule_offerId" ON "commission_rules"("operatorOfferId");

-- CreateIndex
CREATE UNIQUE INDEX "earning_transactions_idempotencyKey_key" ON "earning_transactions"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "earning_transactions_walletTransactionId_key" ON "earning_transactions"("walletTransactionId");

-- CreateIndex
CREATE INDEX "idx_earning_appUserId_createdAt" ON "earning_transactions"("appUserId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_earning_program_status" ON "earning_transactions"("program", "status");

-- CreateIndex
CREATE INDEX "idx_earning_orderId" ON "earning_transactions"("orderId");

-- CreateIndex
CREATE INDEX "idx_earning_productOrderId" ON "earning_transactions"("productOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "referral_milestone_rewards_appUserId_key" ON "referral_milestone_rewards"("appUserId");

-- CreateIndex
CREATE UNIQUE INDEX "referral_milestone_rewards_earningTransactionId_key" ON "referral_milestone_rewards"("earningTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_links_code_key" ON "affiliate_links"("code");

-- CreateIndex
CREATE INDEX "idx_affiliate_link_appUserId" ON "affiliate_links"("appUserId");

-- CreateIndex
CREATE INDEX "idx_affiliate_link_productId" ON "affiliate_links"("productId");

-- CreateIndex
CREATE INDEX "idx_affiliate_attribution_appUserId" ON "affiliate_attributions"("affiliateAppUserId");

-- CreateIndex
CREATE INDEX "idx_affiliate_attribution_linkId" ON "affiliate_attributions"("affiliateLinkId");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_attributions_customerUserId_productId_key" ON "affiliate_attributions"("customerUserId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_conversions_earningTransactionId_key" ON "affiliate_conversions"("earningTransactionId");

-- CreateIndex
CREATE INDEX "idx_affiliate_conversion_appUserId" ON "affiliate_conversions"("affiliateAppUserId");

-- CreateIndex
CREATE INDEX "idx_affiliate_conversion_productId" ON "affiliate_conversions"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_conversions_productOrderId_productId_key" ON "affiliate_conversions"("productOrderId", "productId");

-- AddForeignKey
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_operatorOfferId_fkey" FOREIGN KEY ("operatorOfferId") REFERENCES "operators_offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "earning_transactions" ADD CONSTRAINT "earning_transactions_appUserId_fkey" FOREIGN KEY ("appUserId") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "earning_transactions" ADD CONSTRAINT "earning_transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "earning_transactions" ADD CONSTRAINT "earning_transactions_commissionRuleId_fkey" FOREIGN KEY ("commissionRuleId") REFERENCES "commission_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "earning_transactions" ADD CONSTRAINT "earning_transactions_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "earning_transactions" ADD CONSTRAINT "earning_transactions_productOrderId_fkey" FOREIGN KEY ("productOrderId") REFERENCES "product_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "earning_transactions" ADD CONSTRAINT "earning_transactions_walletTransactionId_fkey" FOREIGN KEY ("walletTransactionId") REFERENCES "wallet_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_milestone_rewards" ADD CONSTRAINT "referral_milestone_rewards_appUserId_fkey" FOREIGN KEY ("appUserId") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_milestone_rewards" ADD CONSTRAINT "referral_milestone_rewards_earningTransactionId_fkey" FOREIGN KEY ("earningTransactionId") REFERENCES "earning_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_links" ADD CONSTRAINT "affiliate_links_appUserId_fkey" FOREIGN KEY ("appUserId") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_links" ADD CONSTRAINT "affiliate_links_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_attributions" ADD CONSTRAINT "affiliate_attributions_customerUserId_fkey" FOREIGN KEY ("customerUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_attributions" ADD CONSTRAINT "affiliate_attributions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_attributions" ADD CONSTRAINT "affiliate_attributions_affiliateLinkId_fkey" FOREIGN KEY ("affiliateLinkId") REFERENCES "affiliate_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_attributions" ADD CONSTRAINT "affiliate_attributions_affiliateAppUserId_fkey" FOREIGN KEY ("affiliateAppUserId") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_conversions" ADD CONSTRAINT "affiliate_conversions_affiliateAttributionId_fkey" FOREIGN KEY ("affiliateAttributionId") REFERENCES "affiliate_attributions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_conversions" ADD CONSTRAINT "affiliate_conversions_productOrderId_fkey" FOREIGN KEY ("productOrderId") REFERENCES "product_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_conversions" ADD CONSTRAINT "affiliate_conversions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_conversions" ADD CONSTRAINT "affiliate_conversions_affiliateAppUserId_fkey" FOREIGN KEY ("affiliateAppUserId") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_conversions" ADD CONSTRAINT "affiliate_conversions_earningTransactionId_fkey" FOREIGN KEY ("earningTransactionId") REFERENCES "earning_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
