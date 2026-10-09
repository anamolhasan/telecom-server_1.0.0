import { describe, expect, it } from "vitest";
import {
    OrderStatus,
    PaymentStatus,
    ReferralApplicationStatus,
} from "../../../generated/prisma/enums";
import {
    computeReferralEligibility,
    qualifiesAsActiveReferredPurchase,
} from "./referral.rule";

const FIXED_NOW = new Date("2026-10-09T12:00:00.000Z");

describe("computeReferralEligibility", () => {
    it("is eligible only when approved AND at least 3 active referred accounts", () => {
        expect(computeReferralEligibility(ReferralApplicationStatus.APPROVED, 3).eligible).toBe(true);
        expect(computeReferralEligibility(ReferralApplicationStatus.APPROVED, 4).eligible).toBe(true);
    });

    it("suspends eligibility when the active count falls from 3 to 2", () => {
        const result = computeReferralEligibility(ReferralApplicationStatus.APPROVED, 2);
        expect(result.eligible).toBe(false);
        expect(result.approved).toBe(true);
        expect(result.activeReferredCount).toBe(2);
    });

    it("restores eligibility when the active count rises from 2 to 3", () => {
        expect(computeReferralEligibility(ReferralApplicationStatus.APPROVED, 2).eligible).toBe(false);
        expect(computeReferralEligibility(ReferralApplicationStatus.APPROVED, 3).eligible).toBe(true);
    });

    it("never lets an unapproved user earn, even with many active referred accounts", () => {
        expect(computeReferralEligibility(ReferralApplicationStatus.PENDING, 5).eligible).toBe(false);
        expect(computeReferralEligibility(ReferralApplicationStatus.REJECTED, 5).eligible).toBe(false);
        expect(computeReferralEligibility(null, 5).eligible).toBe(false);
    });
});

describe("qualifiesAsActiveReferredPurchase", () => {
    const completed = (overrides: Partial<Parameters<typeof qualifiesAsActiveReferredPurchase>[0]> = {}) => ({
        status: OrderStatus.COMPLETED,
        paymentStatus: PaymentStatus.PAID,
        completedAt: new Date("2026-09-01T00:00:00.000Z"),
        ...overrides,
    });

    it("qualifies a completed, paid order inside the rolling window", () => {
        expect(qualifiesAsActiveReferredPurchase(completed(), FIXED_NOW)).toBe(true);
    });

    it("does not qualify cancelled, failed, or unfulfilled orders", () => {
        expect(qualifiesAsActiveReferredPurchase(completed({ status: OrderStatus.CANCELLED }), FIXED_NOW)).toBe(false);
        expect(qualifiesAsActiveReferredPurchase(completed({ status: OrderStatus.FAILED }), FIXED_NOW)).toBe(false);
        expect(qualifiesAsActiveReferredPurchase(completed({ status: OrderStatus.PENDING }), FIXED_NOW)).toBe(false);
        expect(qualifiesAsActiveReferredPurchase(completed({ status: OrderStatus.PROCESSING }), FIXED_NOW)).toBe(false);
    });

    it("does not qualify fully refunded purchases", () => {
        expect(qualifiesAsActiveReferredPurchase(completed({ paymentStatus: PaymentStatus.REFUNDED }), FIXED_NOW)).toBe(false);
        expect(qualifiesAsActiveReferredPurchase(completed({ paymentStatus: PaymentStatus.CANCELLED }), FIXED_NOW)).toBe(false);
    });

    it("does not qualify an order without a completion timestamp", () => {
        expect(qualifiesAsActiveReferredPurchase(completed({ completedAt: null }), FIXED_NOW)).toBe(false);
    });

    it("expires when the qualifying purchase moves outside the rolling 6-month window", () => {
        const now = new Date("2026-10-09T12:00:00.000Z");
        const cutoff = new Date("2026-04-09T12:00:00.000Z"); // exactly 6 months before now

        expect(qualifiesAsActiveReferredPurchase(completed({ completedAt: cutoff }), now)).toBe(true);

        const justOutside = new Date(cutoff.getTime() - 1);
        expect(qualifiesAsActiveReferredPurchase(completed({ completedAt: justOutside }), now)).toBe(false);
    });
});