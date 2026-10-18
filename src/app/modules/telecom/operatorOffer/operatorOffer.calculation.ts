import type {
    OperatorOfferCommissionType,
    OperatorOfferDiscountType,
    OperatorOfferType,
} from "../../../../generated/prisma/enums";
import { ProductType } from "../../../../generated/prisma/enums";

// Authoritative, server-side offer maths. The client may preview these values but
// the server always recomputes them from the raw configuration before persisting,
// so a tampered payload can never poison the stored financials.

export interface OfferPriceBreakdown {
    discountAmount: number;
    sellingPrice: number;
}

export interface ProfitScenario {
    commissionAmount: number;
    estimatedProfit: number;
    isNegative: boolean;
}

export interface ProfitBreakdown {
    resellerSale: ProfitScenario;
    agentSale: ProfitScenario;
    directSale: ProfitScenario;
}

export interface CommissionConfig {
    type: OperatorOfferCommissionType;
    value: number;
}

export const OFFER_TYPE_TO_PRODUCT_TYPE: Record<OperatorOfferType, ProductType> =
    {
        MB: ProductType.INTERNET,
        MINUTE: ProductType.MINUTE,
        SMS: ProductType.OTHER,
        BUNDLE: ProductType.BUNDLE,
        COMBO: ProductType.BUNDLE,
        OTHER: ProductType.OTHER,
    };

export function clampNonNegative(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return value < 0 ? 0 : value;
}

export function roundToCents(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.round(value * 100) / 100;
}

export function calculateSellingPrice(
    regularPrice: number,
    discountType: OperatorOfferDiscountType,
    discountValue: number,
): OfferPriceBreakdown {
    const rp = clampNonNegative(regularPrice);
    const dv = clampNonNegative(discountValue);

    let discountAmount = 0;

    if (discountType === "FIXED") {
        discountAmount = dv;
    } else if (discountType === "PERCENTAGE") {
        const pct = dv > 100 ? 100 : dv;
        discountAmount = (rp * pct) / 100;
    }

    if (discountAmount > rp) {
        discountAmount = rp;
    }

    const sellingPrice = roundToCents(rp - discountAmount);

    return {
        discountAmount: roundToCents(discountAmount),
        sellingPrice: sellingPrice < 0 ? 0 : sellingPrice,
    };
}

export function resolveCommissionAmount(
    sellingPrice: number,
    type: OperatorOfferCommissionType,
    value: number,
): number {
    const amount = clampNonNegative(value);

    if (type === "PERCENTAGE") {
        const pct = amount > 100 ? 100 : amount;
        return roundToCents((clampNonNegative(sellingPrice) * pct) / 100);
    }

    return roundToCents(amount);
}

export function calculateProfitBreakdown(input: {
    regularPrice: number;
    discountType: OperatorOfferDiscountType;
    discountValue: number;
    companyPurchasePrice: number;
    resellerCommission: CommissionConfig;
    agentCommission: CommissionConfig;
}): ProfitBreakdown {
    const { sellingPrice } = calculateSellingPrice(
        input.regularPrice,
        input.discountType,
        input.discountValue,
    );

    const cost = clampNonNegative(input.companyPurchasePrice);
    const resellerCommission = resolveCommissionAmount(
        sellingPrice,
        input.resellerCommission.type,
        input.resellerCommission.value,
    );
    const agentCommission = resolveCommissionAmount(
        sellingPrice,
        input.agentCommission.type,
        input.agentCommission.value,
    );

    const buildScenario = (commissionAmount: number): ProfitScenario => {
        const profit = roundToCents(sellingPrice - cost - commissionAmount);
        return {
            commissionAmount: roundToCents(commissionAmount),
            estimatedProfit: profit,
            isNegative: profit < 0,
        };
    };

    return {
        resellerSale: buildScenario(resellerCommission),
        agentSale: buildScenario(agentCommission),
        directSale: buildScenario(0),
    };
}

// Convert an absolute commission amount (BDT) to a percentage of the selling
// price, matching the Order/commission model which stores a percentage rate.
export function commissionAmountToRatePercent(
    sellingPrice: number,
    commissionAmount: number,
): number {
    const sp = clampNonNegative(sellingPrice);
    const ca = clampNonNegative(commissionAmount);

    if (sp <= 0 || ca <= 0) return 0;

    const pct = (ca / sp) * 100;
    if (!Number.isFinite(pct) || pct < 0) return 0;

    return roundToCents(pct > 100 ? 100 : pct);
}

export interface ComputedOfferFinancials {
    discountAmount: number;
    sellingPrice: number;
    commissionRate: number;
    resellerCommissionAmount: number;
    agentCommissionAmount: number;
    resellerProfit: number;
    agentProfit: number;
    directProfit: number;
}

export function computeOfferFinancials(input: {
    regularPrice: number;
    discountType: OperatorOfferDiscountType;
    discountValue: number;
    companyPurchasePrice: number;
    resellerCommission: CommissionConfig;
    agentCommission: CommissionConfig;
}): ComputedOfferFinancials {
    const price = calculateSellingPrice(
        input.regularPrice,
        input.discountType,
        input.discountValue,
    );
    const profits = calculateProfitBreakdown(input);

    return {
        discountAmount: price.discountAmount,
        sellingPrice: price.sellingPrice,
        commissionRate: commissionAmountToRatePercent(
            price.sellingPrice,
            profits.resellerSale.commissionAmount,
        ),
        resellerCommissionAmount: profits.resellerSale.commissionAmount,
        agentCommissionAmount: profits.agentSale.commissionAmount,
        resellerProfit: profits.resellerSale.estimatedProfit,
        agentProfit: profits.agentSale.estimatedProfit,
        directProfit: profits.directSale.estimatedProfit,
    };
}
