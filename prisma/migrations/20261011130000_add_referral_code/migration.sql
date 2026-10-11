-- AlterTable
ALTER TABLE "app_user" ADD COLUMN     "referralCode" TEXT;

-- Backfill a unique referral code for every existing app user (including existing
-- users only gets a code — no existing data is overwritten).
DO $$
DECLARE
    existing_user RECORD;
    candidate TEXT;
BEGIN
    FOR existing_user IN SELECT id FROM "app_user" WHERE "referralCode" IS NULL LOOP
        LOOP
            candidate := upper(substr(md5(gen_random_uuid()::text), 1, 8));
            EXIT WHEN NOT EXISTS (SELECT 1 FROM "app_user" WHERE "referralCode" = candidate);
        END LOOP;
        UPDATE "app_user" SET "referralCode" = candidate WHERE id = existing_user.id;
    END LOOP;
END $$;

-- AlterTable
ALTER TABLE "app_user" ALTER COLUMN "referralCode" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "app_user_referralCode_key" ON "app_user"("referralCode");