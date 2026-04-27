/*
  Warnings:

  - You are about to drop the `AppUser` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "AppUser" DROP CONSTRAINT "AppUser_authUserId_fkey";

-- DropForeignKey
ALTER TABLE "AppUser" DROP CONSTRAINT "AppUser_referredBy_fkey";

-- DropTable
DROP TABLE "AppUser";

-- CreateTable
CREATE TABLE "app_user" (
    "id" TEXT NOT NULL,
    "authUserId" TEXT NOT NULL,
    "profilePhoto" TEXT,
    "contactNumber" TEXT,
    "address" TEXT,
    "country" TEXT,
    "canEarn" BOOLEAN NOT NULL DEFAULT false,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalEarned" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "referredBy" TEXT,
    "lastLogin" TIMESTAMP(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_user_authUserId_key" ON "app_user"("authUserId");

-- CreateIndex
CREATE INDEX "app_user_referredBy_idx" ON "app_user"("referredBy");

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_authUserId_fkey" FOREIGN KEY ("authUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_referredBy_fkey" FOREIGN KEY ("referredBy") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
