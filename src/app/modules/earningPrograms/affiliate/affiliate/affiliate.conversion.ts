import { Prisma } from "../../../../../generated/prisma/client";
import {
    EarningProgram,
    EarningRuleScope,
    EarningRuleType,
    EarningStatus,
    WalletTransactionReason,
} from "../../../../../generated/prisma/enums";
import { toMoneyCents, toMoneyNumber } from "../../../ecommerce/ecommerce.utils";
import {
    affiliateConversionIdempotencyKey,
    computeEarningAmountCents,
} from "../../../earning/earning.rule";
import { EarningService } from "../../../earning/earning.service";
import { isQualifyingConversionState, ruleRefIdForScope } from "./affiliate.rule";

// ─────────────────────────────────────────────────────────────────────────────
// Affiliate conversion settlement
// ─────────────────────────────────────────────────────────────────────────────
// A conversion is confirmed per PRODUCT per order, using the product's PERMANENT
// attribution. One order containing products attributed to different affiliates
// is therefore credited correctly — it is never collapsed onto a single affiliate.
//
// Safety properties:
//   1. Idempotent at the database: `(productOrderId, productId)` is UNIQUE and the
//      earning ledger key is derived from the same triple, so a duplicate payment
//      event, a retry or a re-settlement can never credit twice.
//   2. Derived, never trusted: qualification (DELIVERED + PAID), the attribution
//      and the commission rule are all re-read inside the transaction.
//   3. No rate is invented: an unconfigured affiliate rule yields no commission.

export interface IRecordedConversion {
    productId: string;
    affiliateAppUserId: string;
    amount: number;
    credited: boolean;
}

const resolveAffiliateCommission = async (
    tx: Prisma.TransactionClient,
    productId: string,
) =>
    EarningService.resolveCommissionRule(tx, {
        program: EarningProgram.AFFILIATE,
        productId,
    });

const recordConversionsForProductOrder = async (
    tx: Prisma.TransactionClient,
    productOrderId: string,
): Promise<IRecordedConversion[]> => {
    const order = await tx.productOrder.findUnique({
        where: { id: productOrderId },
        select: {
            id: true,
            userId: true,
            status: true,
            paymentStatus: true,
        },
    });

    if (!order || !isQualifyingConversionState(order.status, order.paymentStatus)) {
        return [];
    }

    const items = await tx.productOrderItem.findMany({
        where: { productOrderId },
        select: { productId: true, lineTotal: true },
    });

    const recorded: IRecordedConversion[] = [];
    const seenProducts = new Set<string>();

    for (const item of items) {
        // Items without a live product reference keep their snapshot name but
        // cannot be attributed or credited.
        if (!item.productId || seenProducts.has(item.productId)) {
            continue;
        }
        seenProducts.add(item.productId);

        const attribution = await tx.affiliateAttribution.findUnique({
            where: {
                uniq_affiliate_attribution_customer_product: {
                    customerUserId: order.userId,
                    productId: item.productId,
                },
            },
        });

        if (!attribution) {
            continue;
        }

        const existing = await tx.affiliateConversion.findUnique({
            where: {
                uniq_affiliate_conversion_order_product: {
                    productOrderId,
                    productId: item.productId,
                },
            },
        });

        if (existing) {
            recorded.push({
                productId: item.productId,
                affiliateAppUserId: existing.affiliateAppUserId,
                amount: Number(existing.amount),
                credited: existing.earningTransactionId !== null,
            });
            continue;
        }

        const baseAmountCents = toMoneyCents(item.lineTotal);
        const rule = await resolveAffiliateCommission(tx, item.productId);
        const amountCents = rule
            ? computeEarningAmountCents(rule.ruleType, rule.value, baseAmountCents)
            : 0;

        const affiliate = await tx.appUser.findUniqueOrThrow({
            where: { id: attribution.affiliateAppUserId },
            select: { id: true, authUserId: true },
        });

        const conversion = await tx.affiliateConversion.create({
            data: {
                affiliateAttributionId: attribution.id,
                productOrderId,
                productId: item.productId,
                affiliateAppUserId: attribution.affiliateAppUserId,
                status: amountCents > 0 ? EarningStatus.PENDING : EarningStatus.REVERSED,
                orderAmount: (baseAmountCents / 100).toFixed(2),
                amount: (amountCents / 100).toFixed(2),
                currency: "bdt",
            },
        });

        if (amountCents <= 0) {
            // Attributed, but no commission rule is configured for this product.
            // Nothing is credited and no rate is invented.
            recorded.push({
                productId: item.productId,
                affiliateAppUserId: attribution.affiliateAppUserId,
                amount: 0,
                credited: false,
            });
            continue;
        }

        const earning = await EarningService.createEarning(tx, {
            program: EarningProgram.AFFILIATE,
            appUserId: affiliate.id,
            userId: affiliate.authUserId,
            amountCents,
            baseAmountCents,
            walletReason: WalletTransactionReason.AFFILIATE_COMMISSION,
            rule: rule
                ? {
                    scope: rule.scope,
                    ruleType: rule.ruleType,
                    value: toMoneyNumber(rule.value),
                    refId: ruleRefIdForScope(rule),
                    commissionRuleId: rule.id,
                }
                : {
                    scope: EarningRuleScope.GLOBAL,
                    ruleType: EarningRuleType.FIXED,
                    value: 0,
                    refId: null,
                },
            idempotencyKey: affiliateConversionIdempotencyKey(
                productOrderId,
                item.productId,
                attribution.affiliateAppUserId,
            ),
            productOrderId,
            description: `Affiliate commission for product order ${productOrderId}`,
        });

        await tx.affiliateConversion.update({
            where: { id: conversion.id },
            data: {
                status: EarningStatus.AVAILABLE,
                availableAt: new Date(),
                earningTransactionId: earning.id,
            },
        });

        recorded.push({
            productId: item.productId,
            affiliateAppUserId: attribution.affiliateAppUserId,
            amount: amountCents / 100,
            credited: true,
        });
    }

    return recorded;
};

// Revoke every affiliate commission that this order produced, without moving the
// balance a second time. The wallet reversal itself is performed by the shared
// earning ledger (see EarningService.markEarningsReversedForSource), so a refund
// or cancellation cannot leave a conversion looking paid.
const revokeConversionsForProductOrder = async (
    tx: Prisma.TransactionClient,
    productOrderId: string,
): Promise<number> => {
    const updated = await tx.affiliateConversion.updateMany({
        where: {
            productOrderId,
            status: { in: [EarningStatus.PENDING, EarningStatus.AVAILABLE] },
        },
        data: { status: EarningStatus.REVERSED, reversedAt: new Date() },
    });

    return updated.count;
};

export const AffiliateConversionService = {
    recordConversionsForProductOrder,
    revokeConversionsForProductOrder,
};
