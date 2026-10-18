import { describe, expect, it } from "vitest";
import { ProductType } from "../../../../generated/prisma/enums";
import {
    calculateProfitBreakdown,
    calculateSellingPrice,
    clampNonNegative,
    commissionAmountToRatePercent,
    computeOfferFinancials,
    OFFER_TYPE_TO_PRODUCT_TYPE,
    resolveCommissionAmount,
    roundToCents,
} from "./operatorOffer.calculation";

describe("clampNonNegative", () => {
    it("clamps negatives and non-finite values to zero", () => {
        expect(clampNonNegative(-5)).toBe(0);
        expect(clampNonNegative(Number.NaN)).toBe(0);
        expect(clampNonNegative(Number.POSITIVE_INFINITY)).toBe(0);
    });

    it("passes through non-negative numbers", () => {
        expect(clampNonNegative(0)).toBe(0);
        expect(clampNonNegative(12.34)).toBe(12.34);
    });
});

describe("roundToCents", () => {
    it("rounds to two decimals", () => {
        expect(roundToCents(1.239)).toBe(1.24);
        expect(roundToCents(1.004)).toBe(1);
    });

    it("returns zero for non-finite input", () => {
        expect(roundToCents(Number.NaN)).toBe(0);
        expect(roundToCents(Number.POSITIVE_INFINITY)).toBe(0);
    });
});

describe("calculateSellingPrice", () => {
    it("returns the regular price when there is no discount", () => {
        const result = calculateSellingPrice(100, "NONE", 25);

        expect(result.discountAmount).toBe(0);
        expect(result.sellingPrice).toBe(100);
    });

    it("subtracts a fixed discount", () => {
        const result = calculateSellingPrice(100, "FIXED", 15);

        expect(result.discountAmount).toBe(15);
        expect(result.sellingPrice).toBe(85);
    });

    it("applies a percentage discount", () => {
        const result = calculateSellingPrice(200, "PERCENTAGE", 12.5);

        expect(result.discountAmount).toBe(25);
        expect(result.sellingPrice).toBe(175);
    });

    it("caps a percentage above 100 at the full price", () => {
        const result = calculateSellingPrice(100, "PERCENTAGE", 250);

        expect(result.discountAmount).toBe(100);
        expect(result.sellingPrice).toBe(0);
    });

    it("never discounts below zero", () => {
        const result = calculateSellingPrice(50, "FIXED", 999);

        expect(result.discountAmount).toBe(50);
        expect(result.sellingPrice).toBe(0);
    });

    it("treats negative inputs as zero", () => {
        const result = calculateSellingPrice(-10, "FIXED", -5);

        expect(result.discountAmount).toBe(0);
        expect(result.sellingPrice).toBe(0);
    });
});

describe("resolveCommissionAmount", () => {
    it("returns a fixed amount", () => {
        expect(resolveCommissionAmount(100, "FIXED", 20)).toBe(20);
    });

    it("computes a percentage amount", () => {
        expect(resolveCommissionAmount(200, "PERCENTAGE", 10)).toBe(20);
    });

    it("caps a percentage above 100", () => {
        expect(resolveCommissionAmount(80, "PERCENTAGE", 150)).toBe(80);
    });

    it("rounds to cents and clamps negatives", () => {
        expect(resolveCommissionAmount(100, "PERCENTAGE", 33.333)).toBe(33.33);
        expect(resolveCommissionAmount(100, "FIXED", -5)).toBe(0);
    });
});

describe("calculateProfitBreakdown", () => {
    const base = {
        regularPrice: 100,
        discountType: "FIXED" as const,
        discountValue: 0,
        companyPurchasePrice: 60,
        resellerCommission: { type: "FIXED" as const, value: 10 },
        agentCommission: { type: "PERCENTAGE" as const, value: 20 },
    };

    it("computes profit per scenario", () => {
        const breakdown = calculateProfitBreakdown(base);

        expect(breakdown.resellerSale.commissionAmount).toBe(10);
        expect(breakdown.resellerSale.estimatedProfit).toBe(30);
        expect(breakdown.agentSale.commissionAmount).toBe(20);
        expect(breakdown.agentSale.estimatedProfit).toBe(20);
        expect(breakdown.directSale.commissionAmount).toBe(0);
        expect(breakdown.directSale.estimatedProfit).toBe(40);
    });

    it("flags negative profit", () => {
        const breakdown = calculateProfitBreakdown({
            ...base,
            companyPurchasePrice: 95,
            resellerCommission: { type: "FIXED", value: 10 },
        });

        expect(breakdown.resellerSale.estimatedProfit).toBe(-5);
        expect(breakdown.resellerSale.isNegative).toBe(true);
        expect(breakdown.directSale.isNegative).toBe(false);
    });
});

describe("commissionAmountToRatePercent", () => {
    it("converts an amount to a percentage of the selling price", () => {
        expect(commissionAmountToRatePercent(200, 50)).toBe(25);
    });

    it("returns zero when there is no selling price or no commission", () => {
        expect(commissionAmountToRatePercent(0, 50)).toBe(0);
        expect(commissionAmountToRatePercent(100, 0)).toBe(0);
    });

    it("caps at 100 percent", () => {
        expect(commissionAmountToRatePercent(100, 250)).toBe(100);
    });
});

describe("computeOfferFinancials", () => {
    it("produces a full financial summary from the raw configuration", () => {
        const financials = computeOfferFinancials({
            regularPrice: 200,
            discountType: "PERCENTAGE",
            discountValue: 10,
            companyPurchasePrice: 100,
            resellerCommission: { type: "PERCENTAGE", value: 5 },
            agentCommission: { type: "FIXED", value: 15 },
        });

        expect(financials.discountAmount).toBe(20);
        expect(financials.sellingPrice).toBe(180);
        expect(financials.resellerCommissionAmount).toBe(9);
        expect(financials.agentCommissionAmount).toBe(15);
        expect(financials.commissionRate).toBe(5);
        expect(financials.resellerProfit).toBe(71);
        expect(financials.agentProfit).toBe(65);
        expect(financials.directProfit).toBe(80);
    });
});

describe("OFFER_TYPE_TO_PRODUCT_TYPE", () => {
    it("maps every offer type to a legacy product type", () => {
        expect(OFFER_TYPE_TO_PRODUCT_TYPE).toEqual({
            MB: ProductType.INTERNET,
            MINUTE: ProductType.MINUTE,
            SMS: ProductType.OTHER,
            BUNDLE: ProductType.BUNDLE,
            COMBO: ProductType.BUNDLE,
            OTHER: ProductType.OTHER,
        });
    });
});
