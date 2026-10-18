import { describe, expect, it } from "vitest";
import {
    EarningRuleScope,
    ProductOrderStatus,
    ProductPaymentStatus,
} from "../../../../../generated/prisma/enums";
import {
    AFFILIATE_LINK_CODE_LENGTH,
    generateAffiliateLinkCode,
    isQualifyingConversionState,
    isSelfAttribution,
    ruleRefIdForScope,
} from "./affiliate.rule";

describe("generateAffiliateLinkCode", () => {
    it("generates an unambiguous code of the configured length", () => {
        const code = generateAffiliateLinkCode();

        expect(code).toHaveLength(AFFILIATE_LINK_CODE_LENGTH);
        // No 0/O/1/I so a code can be read back from a customer safely.
        expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/);
        expect(generateAffiliateLinkCode(6)).toHaveLength(6);
    });

    it("does not repeat codes in a reasonable sample", () => {
        const codes = new Set(
            Array.from({ length: 200 }, () => generateAffiliateLinkCode()),
        );

        expect(codes.size).toBe(200);
    });
});

describe("isSelfAttribution", () => {
    it("refuses an affiliate attributing their own purchase", () => {
        expect(isSelfAttribution("auth-1", "auth-1")).toBe(true);
    });

    it("allows a different customer", () => {
        expect(isSelfAttribution("auth-1", "auth-2")).toBe(false);
    });
});

describe("isQualifyingConversionState", () => {
    it("qualifies only a DELIVERED and PAID order", () => {
        expect(
            isQualifyingConversionState(
                ProductOrderStatus.DELIVERED,
                ProductPaymentStatus.PAID,
            ),
        ).toBe(true);
    });

    it("never qualifies a delivered but unpaid COD order", () => {
        expect(
            isQualifyingConversionState(
                ProductOrderStatus.DELIVERED,
                ProductPaymentStatus.UNPAID,
            ),
        ).toBe(false);
    });

    it.each([
        ProductOrderStatus.PENDING,
        ProductOrderStatus.CONFIRMED,
        ProductOrderStatus.PROCESSING,
        ProductOrderStatus.SHIPPED,
        ProductOrderStatus.CANCELLED,
    ])("never qualifies a %s order even when paid", (orderStatus) => {
        expect(
            isQualifyingConversionState(orderStatus, ProductPaymentStatus.PAID),
        ).toBe(false);
    });
});

describe("ruleRefIdForScope", () => {
    it("points the snapshot at the identifier the scope resolves", () => {
        expect(
            ruleRefIdForScope({
                scope: EarningRuleScope.PRODUCT,
                productId: "p1",
            }),
        ).toBe("p1");
        expect(
            ruleRefIdForScope({
                scope: EarningRuleScope.PRODUCT_VARIANT,
                productVariantId: "v1",
            }),
        ).toBe("v1");
        expect(
            ruleRefIdForScope({
                scope: EarningRuleScope.OPERATOR_OFFER,
                operatorOfferId: "o1",
            }),
        ).toBe("o1");
        expect(ruleRefIdForScope({ scope: EarningRuleScope.GLOBAL })).toBeNull();
    });
});
