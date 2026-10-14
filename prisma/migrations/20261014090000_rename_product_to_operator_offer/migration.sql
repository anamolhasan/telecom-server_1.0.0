-- Rename Product -> OperatorOffer and enrich it with offer authoring fields.
-- Non-destructive: the physical table is renamed (not dropped/recreated), all
-- existing rows, ids and Order foreign keys are preserved. New columns are either
-- nullable or carry defaults, so existing rows remain valid.

-- 1. New enums used by the enriched OperatorOffer.
CREATE TYPE "OperatorOfferType" AS ENUM ('MB', 'MINUTE', 'SMS', 'BUNDLE', 'COMBO', 'OTHER');
CREATE TYPE "OperatorOfferAmountUnit" AS ENUM ('MB', 'GB', 'MINUTE', 'HOUR', 'SMS', 'PCS');
CREATE TYPE "OperatorOfferValidityUnit" AS ENUM ('HOURS', 'DAYS', 'WEEKS', 'MONTHS');
CREATE TYPE "OperatorOfferDiscountType" AS ENUM ('NONE', 'FIXED', 'PERCENTAGE');
CREATE TYPE "OperatorOfferCommissionType" AS ENUM ('FIXED', 'PERCENTAGE');
CREATE TYPE "OperatorOfferInventoryMode" AS ENUM ('LIMITED', 'UNLIMITED');
CREATE TYPE "OperatorOfferBadge" AS ENUM ('NEW', 'POPULAR', 'BEST_VALUE', 'LIMITED_TIME');
CREATE TYPE "OperatorOfferStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'EXPIRED', 'OUT_OF_STOCK');

-- 2. Rename the physical table products -> operators_offers (keeps all data).
ALTER TABLE "products" RENAME TO "operators_offers";

-- 3. Rename primary key + foreign key constraints to match the new table name.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_pkey') THEN
        ALTER TABLE "operators_offers" RENAME CONSTRAINT "products_pkey" TO "operators_offers_pkey";
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_operatorId_fkey') THEN
        ALTER TABLE "operators_offers" RENAME CONSTRAINT "products_operatorId_fkey" TO "operators_offers_operatorId_fkey";
    END IF;
END $$;

-- 4. Rename indexes carried over from the products table.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_product_operatorId') THEN
        ALTER INDEX "idx_product_operatorId" RENAME TO "idx_operatorOffer_operatorId";
    END IF;
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_product_isDeleted') THEN
        ALTER INDEX "idx_product_isDeleted" RENAME TO "idx_operatorOffer_isDeleted";
    END IF;
END $$;

-- 5. Additive offer fields. Nullable or defaulted so existing rows stay valid.
ALTER TABLE "operators_offers"
    ADD COLUMN "offerType" "OperatorOfferType" NOT NULL DEFAULT 'OTHER',
    ADD COLUMN "amount" INTEGER,
    ADD COLUMN "amountUnit" "OperatorOfferAmountUnit",
    ADD COLUMN "validityValue" INTEGER,
    ADD COLUMN "validityUnit" "OperatorOfferValidityUnit",
    ADD COLUMN "regularPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN "discountType" "OperatorOfferDiscountType" NOT NULL DEFAULT 'NONE',
    ADD COLUMN "discountValue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN "companyPurchasePrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN "resellerCommissionType" "OperatorOfferCommissionType" NOT NULL DEFAULT 'FIXED',
    ADD COLUMN "resellerCommissionValue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN "agentCommissionType" "OperatorOfferCommissionType" NOT NULL DEFAULT 'FIXED',
    ADD COLUMN "agentCommissionValue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN "inventoryMode" "OperatorOfferInventoryMode" NOT NULL DEFAULT 'UNLIMITED',
    ADD COLUMN "stockQuantity" INTEGER,
    ADD COLUMN "badges" "OperatorOfferBadge"[] DEFAULT ARRAY[]::"OperatorOfferBadge"[],
    ADD COLUMN "startsAt" TIMESTAMP(3),
    ADD COLUMN "endsAt" TIMESTAMP(3),
    ADD COLUMN "status" "OperatorOfferStatus" NOT NULL DEFAULT 'DRAFT';

-- 6. New indexes for the enriched table.
CREATE INDEX "idx_operatorOffer_offerType" ON "operators_offers"("offerType");
CREATE INDEX "idx_operatorOffer_status" ON "operators_offers"("status");

-- 7. price now has a default in the schema (legacy NOT NULL column).
ALTER TABLE "operators_offers" ALTER COLUMN "price" SET DEFAULT 0;

-- 8. Order relation: productId -> operatorOfferId (column kept, renamed in place).
ALTER TABLE "orders" RENAME COLUMN "productId" TO "operatorOfferId";
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_order_productId') THEN
        ALTER INDEX "idx_order_productId" RENAME TO "idx_order_operatorOfferId";
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_productId_fkey') THEN
        ALTER TABLE "orders" RENAME CONSTRAINT "orders_productId_fkey" TO "orders_operatorOfferId_fkey";
    END IF;
END $$;
