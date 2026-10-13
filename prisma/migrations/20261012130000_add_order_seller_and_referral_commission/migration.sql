-- Agent sales attribution + per-offer referral commission.
-- Additive and non-destructive: existing orders remain personal purchases
-- (sellerId NULL) and keep their current stored commission amounts.

ALTER TABLE "products" ADD COLUMN     "referralCommissionRate" DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE "orders" ADD COLUMN     "sellerId" TEXT,
ADD COLUMN     "referralCommissionAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE INDEX "idx_order_sellerId" ON "orders"("sellerId");

ALTER TABLE "orders" ADD CONSTRAINT "orders_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
