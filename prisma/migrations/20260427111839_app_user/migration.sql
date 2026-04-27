/*
  Warnings:

  - You are about to drop the column `balance` on the `user` table. All the data in the column will be lost.
  - You are about to drop the column `canEarn` on the `user` table. All the data in the column will be lost.
  - You are about to drop the column `country` on the `user` table. All the data in the column will be lost.
  - You are about to drop the column `lastLogin` on the `user` table. All the data in the column will be lost.
  - You are about to drop the column `referredBy` on the `user` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "user" DROP CONSTRAINT "user_referredBy_fkey";

-- AlterTable
ALTER TABLE "user" DROP COLUMN "balance",
DROP COLUMN "canEarn",
DROP COLUMN "country",
DROP COLUMN "lastLogin",
DROP COLUMN "referredBy";

-- CreateTable
CREATE TABLE "AppUser" (
    "id" TEXT NOT NULL,
    "authUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "profilePhoto" TEXT,
    "contactNumber" TEXT,
    "address" TEXT,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "canEarn" BOOLEAN NOT NULL DEFAULT false,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalEarned" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "referredBy" TEXT,
    "lastLogin" TIMESTAMP(3),
    "country" TEXT,
    "image" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppUser_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppUser_authUserId_key" ON "AppUser"("authUserId");

-- AddForeignKey
ALTER TABLE "AppUser" ADD CONSTRAINT "AppUser_authUserId_fkey" FOREIGN KEY ("authUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppUser" ADD CONSTRAINT "AppUser_referredBy_fkey" FOREIGN KEY ("referredBy") REFERENCES "AppUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
