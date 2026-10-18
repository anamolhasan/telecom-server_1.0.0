import {
    EarningProgram,
    EarningRuleScope,
    EarningRuleType,
    WalletTransactionReason,
} from "../../../generated/prisma/enums";
import { toMoneyCents } from "../ecommerce/ecommerce.utils";

// ─────────────────────────────────────────────────────────────────────────────
// Pure earning/commission rules. No I/O, no Prisma: everything here is a
// deterministic function so the money maths is trivially testable and cannot be
// influenced by a client, a cached flag or the acting user's role.
// ─────────────────────────────────────────────────────────────────────────────

// PERCENTAGE rule values are stored with two decimals (5.00 === 5%), i.e. in
// hundredths of a percent, so a percentage amount stays exact integer paisa
// arithmetic: amount = round(base * value * 100 / 10_000).
const PERCENT_HUNDREDTHS_DIVISOR = 10_000;

export const computeEarningAmountCents = (
    ruleType: EarningRuleType,
    ruleValue: unknown,
    baseAmountCents: number,
): number => {
    if (!Number.isFinite(baseAmountCents) || baseAmountCents <= 0) {
        return 0;
    }

    if (ruleType === EarningRuleType.FIXED) {
        return Math.max(0, toMoneyCents(ruleValue));
    }

    const percentHundredths = Math.max(0, toMoneyCents(ruleValue));

    return Math.max(
        0,
        Math.round((baseAmountCents * percentHundredths) / PERCENT_HUNDREDTHS_DIVISOR),
    );
};

// Which wallet ledger reason realises an earning for each program. Keeping the
// mapping here (rather than at each call site) means the ledger stays consistent
// and `totalEarned` is always bumped for a genuine earning.
export const walletReasonForProgram = (
    program: EarningProgram,
): WalletTransactionReason => {
    switch (program) {
        case EarningProgram.AGENT:
            return WalletTransactionReason.COMMISSION;
        case EarningProgram.REFERRAL:
            return WalletTransactionReason.REFERRAL_INCOME;
        case EarningProgram.AFFILIATE:
            return WalletTransactionReason.AFFILIATE_COMMISSION;
        default:
            return WalletTransactionReason.COMMISSION;
    }
};

export interface IEarningRuleShape {
    ruleType: EarningRuleType;
    value: unknown;
}

// The immutable, JSON-safe description of the rule that priced an earning. It is
// frozen into EarningTransaction.ruleSnapshot so later rule edits never rewrite
// financial history.
export interface IEarningRuleSnapshot {
    program: EarningProgram;
    scope: EarningRuleScope;
    ruleType: EarningRuleType;
    value: string;
    refId: string | null;
    commissionRuleId: string | null;
}

export const buildRuleSnapshot = (input: {
    program: EarningProgram;
    scope: EarningRuleScope;
    ruleType: EarningRuleType;
    value: unknown;
    refId?: string | null;
    commissionRuleId?: string | null;
}): IEarningRuleSnapshot => ({
    program: input.program,
    scope: input.scope,
    ruleType: input.ruleType,
    // Stored as a fixed 2-decimal string so the snapshot is exact and stable.
    value: (toMoneyCents(input.value) / 100).toFixed(2),
    refId: input.refId ?? null,
    commissionRuleId: input.commissionRuleId ?? null,
});

// Precedence when several configured rules could price one event: the most
// specific scope wins, then the highest priority, then the newest. Input order is
// not significant, so the outcome cannot depend on query ordering.
const SCOPE_SPECIFICITY: Record<EarningRuleScope, number> = {
    [EarningRuleScope.PRODUCT_VARIANT]: 4,
    [EarningRuleScope.PRODUCT]: 3,
    [EarningRuleScope.OPERATOR_OFFER]: 2,
    [EarningRuleScope.GLOBAL]: 1,
};

export interface IPickableRule {
    scope: EarningRuleScope;
    priority: number;
    createdAt: Date | string;
}

export const pickMostSpecificRule = <T extends IPickableRule>(
    rules: T[],
): T | null => {
    if (rules.length === 0) {
        return null;
    }

    return [...rules].sort((left, right) => {
        const bySpecificity =
            SCOPE_SPECIFICITY[right.scope] - SCOPE_SPECIFICITY[left.scope];

        if (bySpecificity !== 0) {
            return bySpecificity;
        }

        if (right.priority !== left.priority) {
            return right.priority - left.priority;
        }

        return (
            new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
        );
    })[0];
};

// A referral milestone is awarded exactly once per referrer, so its idempotency
// key is derived only from the beneficiary — never from an event id a caller
// could vary to mint a second reward.
export const referralMilestoneIdempotencyKey = (appUserId: string): string =>
    `REFERRAL_MILESTONE:${appUserId}`;

export const agentSaleIdempotencyKey = (
    orderId: string,
    sellerAppUserId: string,
): string => `AGENT_SALE:${orderId}:${sellerAppUserId}`;

// One conversion per PRODUCT per order, so the key includes the product. Two
// products attributed to the same affiliate inside one order are two distinct
// conversions; a repeat of either event resolves to the row that already exists.
export const affiliateConversionIdempotencyKey = (
    productOrderId: string,
    productId: string,
    affiliateAppUserId: string,
): string =>
    `AFFILIATE_CONVERSION:${productOrderId}:${productId}:${affiliateAppUserId}`;

export const referralCommissionIdempotencyKey = (
    orderId: string,
    referrerAppUserId: string,
): string => `REFERRAL_COMMISSION:${orderId}:${referrerAppUserId}`;
