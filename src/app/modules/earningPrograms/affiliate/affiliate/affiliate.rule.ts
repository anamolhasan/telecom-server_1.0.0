import { randomInt } from "node:crypto";
import {
    EarningRuleScope,
    ProductOrderStatus,
    ProductPaymentStatus,
} from "../../../../../generated/prisma/enums";

// ─────────────────────────────────────────────────────────────────────────────
// Pure affiliate rules. No I/O: attribution permanence and conversion
// qualification are decided by deterministic functions so no client input, cached
// flag or acting role can change the outcome.
// ─────────────────────────────────────────────────────────────────────────────

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const AFFILIATE_LINK_CODE_LENGTH = 10;

// Affiliate links carry NO expiry: the code is a permanent identifier. Only an
// explicit `isActive = false` by the owner stops NEW attributions, and even that
// never invalidates attributions or conversions already recorded.
export const generateAffiliateLinkCode = (
    length = AFFILIATE_LINK_CODE_LENGTH,
): string => {
    let code = "";
    for (let i = 0; i < length; i++) {
        code += ALPHABET[randomInt(0, ALPHABET.length)];
    }
    return code;
};

// An affiliate can never earn on their own purchase: a customer cannot be
// attributed to a link they own. (Same principle as "no agent commission on the
// agent's own purchase".)
export const isSelfAttribution = (
    linkOwnerAuthUserId: string,
    customerAuthUserId: string,
): boolean => linkOwnerAuthUserId === customerAuthUserId;

// An affiliate conversion is only confirmed once the purchase is genuinely
// fulfilled AND paid. A PENDING/CANCELLED order — or a delivered-but-unpaid COD
// order — must never pay an affiliate.
export const isQualifyingConversionState = (
    orderStatus: ProductOrderStatus,
    paymentStatus: ProductPaymentStatus,
): boolean =>
    orderStatus === ProductOrderStatus.DELIVERED &&
    paymentStatus === ProductPaymentStatus.PAID;

// Which identifier the frozen rule snapshot should point at, by scope.
export const ruleRefIdForScope = (rule: {
    scope: EarningRuleScope;
    productId?: string | null;
    productVariantId?: string | null;
    operatorOfferId?: string | null;
}): string | null => {
    switch (rule.scope) {
        case EarningRuleScope.PRODUCT_VARIANT:
            return rule.productVariantId ?? null;
        case EarningRuleScope.PRODUCT:
            return rule.productId ?? null;
        case EarningRuleScope.OPERATOR_OFFER:
            return rule.operatorOfferId ?? null;
        default:
            return null;
    }
};
