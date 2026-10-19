import { describe, expect, it } from "vitest";
import { ReferralPromotionMethod } from "../../../../../generated/prisma/enums";
import { submitReferralApplicationZodSchema } from "./referralApplication.validation";

const validPayload = {
    promotionMethod: ReferralPromotionMethod.SOCIAL_MEDIA,
    promotionUrl: "https://example.com/promo",
    reason: "I will promote Rizqiva on my social channels.",
    termsAccepted: true,
};

describe("submitReferralApplicationZodSchema", () => {
    it("accepts a fully specified valid payload", () => {
        const result = submitReferralApplicationZodSchema.safeParse(validPayload);
        expect(result.success).toBe(true);
    });

    it("accepts a payload without the optional promotion URL", () => {
        const { promotionUrl, ...withoutUrl } = validPayload;
        void promotionUrl;

        expect(submitReferralApplicationZodSchema.safeParse(withoutUrl).success).toBe(true);
    });

    it("requires a promotion method", () => {
        const { promotionMethod, ...withoutMethod } = validPayload;
        void promotionMethod;

        expect(submitReferralApplicationZodSchema.safeParse(withoutMethod).success).toBe(false);
    });

    it("rejects an unknown promotion method", () => {
        const result = submitReferralApplicationZodSchema.safeParse({
            ...validPayload,
            promotionMethod: "CARRIER_PIGEON",
        });

        expect(result.success).toBe(false);
    });

    it("rejects an invalid promotion URL", () => {
        const result = submitReferralApplicationZodSchema.safeParse({
            ...validPayload,
            promotionUrl: "not-a-valid-url",
        });

        expect(result.success).toBe(false);
    });

    it("rejects a reason shorter than the minimum length", () => {
        const result = submitReferralApplicationZodSchema.safeParse({
            ...validPayload,
            reason: "too short",
        });

        expect(result.success).toBe(false);
    });

    it("strips unknown fields such as untrusted identity identifiers", () => {
        const result = submitReferralApplicationZodSchema.safeParse({
            ...validPayload,
            appUserId: "attacker-app-user",
            userId: "attacker-user",
            role: "SUPER_ADMIN",
        });

        expect(result.success).toBe(true);
        expect(result.success && result.data).toEqual({
            promotionMethod: validPayload.promotionMethod,
            promotionUrl: validPayload.promotionUrl,
            reason: validPayload.reason,
            termsAccepted: true,
        });
    });
});
