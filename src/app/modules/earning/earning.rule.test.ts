import { describe, expect, it } from "vitest";
import {
    EarningProgram,
    EarningRuleScope,
    EarningRuleType,
    WalletTransactionReason,
} from "../../../generated/prisma/enums";
import {
    affiliateConversionIdempotencyKey,
    agentSaleIdempotencyKey,
    buildRuleSnapshot,
    computeEarningAmountCents,
    pickMostSpecificRule,
    referralCommissionIdempotencyKey,
    referralMilestoneIdempotencyKey,
    walletReasonForProgram,
} from "./earning.rule";

describe("computeEarningAmountCents", () => {
    it("treats a FIXED rule value as a flat BDT amount", () => {
        expect(
            computeEarningAmountCents(EarningRuleType.FIXED, 25, 10_000),
        ).toBe(2_500);
    });

    it("treats a PERCENTAGE rule value as a percent of the base", () => {
        // 5% of 100.00 BDT (10_000 paisa) === 5.00 BDT.
        expect(
            computeEarningAmountCents(EarningRuleType.PERCENTAGE, 5, 10_000),
        ).toBe(500);
    });

    it("keeps percentage maths exact in integer paisa", () => {
        // 2.35% of 123.45 BDT = 2.901075 -> 2.90 BDT (290 paisa).
        expect(
            computeEarningAmountCents(EarningRuleType.PERCENTAGE, 2.35, 12_345),
        ).toBe(290);
    });

    it("never returns a negative or fractional amount", () => {
        expect(computeEarningAmountCents(EarningRuleType.FIXED, -10, 1_000)).toBe(0);
        expect(computeEarningAmountCents(EarningRuleType.PERCENTAGE, -5, 1_000)).toBe(0);
    });

    it("returns zero when the base is zero or invalid", () => {
        expect(computeEarningAmountCents(EarningRuleType.PERCENTAGE, 5, 0)).toBe(0);
        expect(
            computeEarningAmountCents(EarningRuleType.PERCENTAGE, 5, Number.NaN),
        ).toBe(0);
    });
});

describe("walletReasonForProgram", () => {
    it("maps each program to its own ledger reason", () => {
        expect(walletReasonForProgram(EarningProgram.AGENT)).toBe(
            WalletTransactionReason.COMMISSION,
        );
        expect(walletReasonForProgram(EarningProgram.REFERRAL)).toBe(
            WalletTransactionReason.REFERRAL_INCOME,
        );
        expect(walletReasonForProgram(EarningProgram.AFFILIATE)).toBe(
            WalletTransactionReason.AFFILIATE_COMMISSION,
        );
    });
});

describe("buildRuleSnapshot", () => {
    it("freezes the rule as an exact 2-decimal string", () => {
        const snapshot = buildRuleSnapshot({
            program: EarningProgram.AGENT,
            scope: EarningRuleScope.PRODUCT,
            ruleType: EarningRuleType.PERCENTAGE,
            value: 7.5,
            refId: "product-1",
            commissionRuleId: "rule-1",
        });

        expect(snapshot).toEqual({
            program: EarningProgram.AGENT,
            scope: EarningRuleScope.PRODUCT,
            ruleType: EarningRuleType.PERCENTAGE,
            value: "7.50",
            refId: "product-1",
            commissionRuleId: "rule-1",
        });
    });
});

describe("pickMostSpecificRule", () => {
    const rule = (
        scope: EarningRuleScope,
        priority = 0,
        createdAt = "2026-01-01T00:00:00.000Z",
    ) => ({ scope, priority, createdAt });

    it("prefers the most specific scope regardless of input order", () => {
        const chosen = pickMostSpecificRule([
            rule(EarningRuleScope.GLOBAL),
            rule(EarningRuleScope.OPERATOR_OFFER),
            rule(EarningRuleScope.PRODUCT_VARIANT),
            rule(EarningRuleScope.PRODUCT),
        ]);

        expect(chosen?.scope).toBe(EarningRuleScope.PRODUCT_VARIANT);
    });

    it("breaks a scope tie by priority", () => {
        const chosen = pickMostSpecificRule([
            rule(EarningRuleScope.PRODUCT, 1),
            rule(EarningRuleScope.PRODUCT, 5),
        ]);

        expect(chosen?.priority).toBe(5);
    });

    it("breaks a priority tie by the newest rule", () => {
        const chosen = pickMostSpecificRule([
            rule(EarningRuleScope.PRODUCT, 0, "2026-01-01T00:00:00.000Z"),
            rule(EarningRuleScope.PRODUCT, 0, "2026-06-01T00:00:00.000Z"),
        ]);

        expect(chosen?.createdAt).toBe("2026-06-01T00:00:00.000Z");
    });

    it("returns null when nothing is configured", () => {
        expect(pickMostSpecificRule([])).toBeNull();
    });
});

describe("idempotency keys", () => {
    it("derives the milestone key from the beneficiary only", () => {
        expect(referralMilestoneIdempotencyKey("app-1")).toBe(
            "REFERRAL_MILESTONE:app-1",
        );
    });

    it("derives order-derived keys from the immutable source event", () => {
        expect(agentSaleIdempotencyKey("o1", "s1")).toBe("AGENT_SALE:o1:s1");
        expect(referralCommissionIdempotencyKey("o1", "r1")).toBe(
            "REFERRAL_COMMISSION:o1:r1",
        );
        expect(affiliateConversionIdempotencyKey("po1", "p1", "a1")).toBe(
            "AFFILIATE_CONVERSION:po1:p1:a1",
        );
    });
});
