import { describe, expect, it } from "vitest";
import { AffiliateApplicationStatus } from "../../../../../generated/prisma/enums";
import {
    reviewAffiliateApplicationZodSchema,
    submitAffiliateApplicationZodSchema,
} from "./affiliateApplication.validation";


describe("submitAffiliateApplicationZodSchema", () => {
    it("accepts an empty payload (reason is optional)", () => {
        expect(submitAffiliateApplicationZodSchema.safeParse({}).success).toBe(true);
    });

    it("accepts a payload with a reason", () => {
        expect(
            submitAffiliateApplicationZodSchema.safeParse({ reason: "I run a big channel" }).success,
        ).toBe(true);
    });

    it("rejects an empty reason string", () => {
        expect(
            submitAffiliateApplicationZodSchema.safeParse({ reason: "   " }).success,
        ).toBe(false);
    });

    it("rejects a reason longer than the maximum length", () => {
        expect(
            submitAffiliateApplicationZodSchema.safeParse({ reason: "a".repeat(2001) }).success,
        ).toBe(false);
    });

    it("strips unknown fields such as untrusted identity identifiers", () => {
        const result = submitAffiliateApplicationZodSchema.safeParse({
            reason: "legit",
            appUserId: "attacker-app-user",
            userId: "attacker-user",
            role: "SUPER_ADMIN",
            status: AffiliateApplicationStatus.APPROVED,
        });

        expect(result.success).toBe(true);
        expect(result.success && result.data).toEqual({ reason: "legit" });
    });
});

describe("reviewAffiliateApplicationZodSchema", () => {
    it("accepts an approval without a rejection reason", () => {
        expect(
            reviewAffiliateApplicationZodSchema.safeParse({
                status: AffiliateApplicationStatus.APPROVED,
            }).success,
        ).toBe(true);
    });

    it("accepts a rejection with a reason", () => {
        expect(
            reviewAffiliateApplicationZodSchema.safeParse({
                status: AffiliateApplicationStatus.REJECTED,
                rejectionReason: "Did not meet criteria",
            }).success,
        ).toBe(true);
    });

    it("requires a valid status", () => {
        expect(reviewAffiliateApplicationZodSchema.safeParse({}).success).toBe(false);
        expect(
            reviewAffiliateApplicationZodSchema.safeParse({ status: "CARRIER_PIGEON" }).success,
        ).toBe(false);
    });
});
