-- CreateEnum
CREATE TYPE "ProductPaymentMethod" AS ENUM ('COD');

-- CreateEnum
CREATE TYPE "ProductPaymentStatus" AS ENUM ('UNPAID', 'PAID');

-- AlterTable
ALTER TABLE "product_orders" ADD COLUMN     "idempotencyKey" VARCHAR(100),
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "paymentMethod" "ProductPaymentMethod" NOT NULL DEFAULT 'COD',
ADD COLUMN     "paymentStatus" "ProductPaymentStatus" NOT NULL DEFAULT 'UNPAID';

-- CreateIndex
CREATE UNIQUE INDEX "product_orders_userId_idempotencyKey_key" ON "product_orders"("userId", "idempotencyKey");
