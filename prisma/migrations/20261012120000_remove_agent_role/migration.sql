/*
  Warnings:

  - The value [AGENT] on the enum `Role` will be removed. Existing rows are
    converted to `USER` first so no account data is lost. Agent capability is
    preserved through `AppUser.canEarn` plus an approved `AgentApplication`.
*/

-- Preserve existing agent accounts: an approved agent is a USER with a badge,
-- not a distinct role. Convert any legacy AGENT rows before dropping the value.
UPDATE "user" SET "role" = 'USER' WHERE "role" = 'AGENT';

-- AlterEnum
BEGIN;
CREATE TYPE "Role_new" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'MODERATOR', 'SUPPORTER', 'EMPLOYEE', 'USER');
ALTER TABLE "public"."user" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "user" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
ALTER TYPE "Role" RENAME TO "Role_old";
ALTER TYPE "Role_new" RENAME TO "Role";
DROP TYPE "public"."Role_old";
ALTER TABLE "user" ALTER COLUMN "role" SET DEFAULT 'USER';
COMMIT;
