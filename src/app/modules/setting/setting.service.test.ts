import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "../../../generated/prisma/client";
import { Role } from "../../../generated/prisma/enums";
import { SettingService } from "./setting.service";

const ELIGIBLE_AUTH_USER = {
    name: "Alice",
    email: "alice@x.com",
    role: Role.ADMIN,
    isDeleted: false,
};

const makeClient = (overrides: {
    setting?: { key: string; value: string } | null;
    referrer?: { isDeleted: boolean; authUser: typeof ELIGIBLE_AUTH_USER } | null;
}) => {
    const client = {
        systemSetting: {
            findUnique: vi.fn().mockResolvedValue(
                overrides.setting === undefined
                    ? { key: "DEFAULT_REFERRAL_CODE", value: "GLOBAL1" }
                    : overrides.setting,
            ),
            upsert: vi.fn().mockResolvedValue({}),
        },
        appUser: {
            findUnique: vi.fn().mockResolvedValue(
                overrides.referrer === undefined
                    ? { isDeleted: false, authUser: ELIGIBLE_AUTH_USER }
                    : overrides.referrer,
            ),
        },
    };

    return client as unknown as Prisma.TransactionClient;
};

describe("SettingService.getDefaultReferralSetting", () => {
    it("returns nulls when no global default is configured", async () => {
        const client = makeClient({ setting: null });

        await expect(SettingService.getDefaultReferralSetting(client)).resolves.toEqual({
            referralCode: null,
            referrer: null,
        });
    });

    it("returns the code and referrer for a configured eligible user", async () => {
        const client = makeClient({});

        await expect(SettingService.getDefaultReferralSetting(client)).resolves.toEqual({
            referralCode: "GLOBAL1",
            referrer: { name: "Alice", email: "alice@x.com", role: Role.ADMIN },
        });
    });

    it("treats a stale setting safely: nulls when the configured user is deleted", async () => {
        const client = makeClient({
            referrer: { isDeleted: true, authUser: ELIGIBLE_AUTH_USER },
        });

        await expect(SettingService.getDefaultReferralSetting(client)).resolves.toEqual({
            referralCode: null,
            referrer: null,
        });
    });
});

describe("SettingService.updateDefaultReferralSetting", () => {
    const actor = { userId: "sa-1", role: Role.SUPER_ADMIN, email: "sa@x.com" };

    it("persists a normalized code and returns the resolved referrer", async () => {
        const client = makeClient({});

        const result = await SettingService.updateDefaultReferralSetting(
            { referralCode: " ab12CD " },
            actor,
            client,
        );

        expect(result).toEqual({
            referralCode: "AB12CD",
            referrer: { name: "Alice", email: "alice@x.com", role: Role.ADMIN },
        });
        expect(client.systemSetting.upsert).toHaveBeenCalledWith({
            where: { key: "DEFAULT_REFERRAL_CODE" },
            update: { value: "AB12CD", updatedBy: "sa-1" },
            create: { key: "DEFAULT_REFERRAL_CODE", value: "AB12CD", updatedBy: "sa-1" },
        });
    });

    it("rejects a code that does not belong to an eligible user", async () => {
        const client = makeClient({ referrer: null });

        await expect(
            SettingService.updateDefaultReferralSetting(
                { referralCode: "NOPE" },
                actor,
                client,
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it("rejects an update when the selected user is deleted", async () => {
        const client = makeClient({
            referrer: { isDeleted: false, authUser: { ...ELIGIBLE_AUTH_USER, isDeleted: true } },
        });

        await expect(
            SettingService.updateDefaultReferralSetting(
                { referralCode: "DELETED1" },
                actor,
                client,
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });
});