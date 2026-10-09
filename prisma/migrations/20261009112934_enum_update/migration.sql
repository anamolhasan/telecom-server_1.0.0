/*
  Warnings:

  - The values [PAID] on the enum `OrderStatus` will be removed. If these variants are still used in the database, this will fail.
  - The values [SUPPORT,STAFF] on the enum `Role` will be removed. If these variants are still used in the database, this will fail.
  - The values [REFERRAL,TOPUP] on the enum `WalletTransactionReason` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "OrderStatus_new" AS ENUM ('PENDING', 'PROCESSING', 'WORKING', 'COMPLETED', 'CANCELLED', 'FAILED');
ALTER TABLE "public"."orders" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "orders" ALTER COLUMN "status" TYPE "OrderStatus_new" USING ("status"::text::"OrderStatus_new");
ALTER TYPE "OrderStatus" RENAME TO "OrderStatus_old";
ALTER TYPE "OrderStatus_new" RENAME TO "OrderStatus";
DROP TYPE "public"."OrderStatus_old";
ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "Role_new" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'MODERATOR', 'SUPPORTER', 'EMPLOYEE', 'AGENT', 'USER');
ALTER TABLE "public"."user" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "user" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
ALTER TYPE "Role" RENAME TO "Role_old";
ALTER TYPE "Role_new" RENAME TO "Role";
DROP TYPE "public"."Role_old";
ALTER TABLE "user" ALTER COLUMN "role" SET DEFAULT 'USER';
COMMIT;

-- AlterEnum
ALTER TYPE "UserStatus" ADD VALUE 'SLEEPING';

-- AlterEnum
BEGIN;
CREATE TYPE "WalletTransactionReason_new" AS ENUM ('COMMISSION', 'REFERRAL_INCOME', 'TOP_UP', 'ORDER_PAYMENT', 'WITHDRAWAL', 'REFUND', 'ADJUSTMENT');
ALTER TABLE "wallet_transactions" ALTER COLUMN "reason" TYPE "WalletTransactionReason_new" USING ("reason"::text::"WalletTransactionReason_new");
ALTER TYPE "WalletTransactionReason" RENAME TO "WalletTransactionReason_old";
ALTER TYPE "WalletTransactionReason_new" RENAME TO "WalletTransactionReason";
DROP TYPE "public"."WalletTransactionReason_old";
COMMIT;
