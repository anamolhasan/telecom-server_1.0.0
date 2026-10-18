import status from "http-status";
import { Prisma } from "../../../generated/prisma/client";
import {
    EarningProgram,
    EarningRuleScope,
    EarningRuleType,
    WalletTransactionReason,
    WalletTransactionType,
} from "../../../generated/prisma/enums";
import AppError from "../../errorHelpers/AppError";
import { toMoneyCents } from "../ecommerce/ecommerce.utils";
import { agentSaleIdempotencyKey } from "../earning/earning.rule";
import { EarningService } from "../earning/earning.service";
import { ReferralIncomeService } from "../earningPrograms/referral/referral.income";
import { ReferralService } from "../earningPrograms/referral/referral.service";
import {
    classifyOrderActor,
    isSuccessfulOrder,
    resolveCommissionIntent,
} from "./commission.rule";

// Award the agent and/or referral commissions for a successful (COMPLETED + PAID)
// order.
//
// The agent commission is recorded in the shared earning ledger (see
// earning.prisma), which is the single source of truth for the credit: it carries
// the frozen commission-rule snapshot and a database-unique idempotency key, so a
// repeated webhook, retry or double settlement can never credit the seller twice.
// Amounts come from the persisted, server-computed Order fields only; the
// eligibility of a referrer is re-derived live by grantReferralIncome.
//
// An agent is never paid for their own purchase: commission is only paid to a
// distinct seller (classifyOrderActor), so a PURCHASE yields no agent commission.
const settleOrderCommissions = async (
    tx: Prisma.TransactionClient,
    orderId: string,
) => {
    const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
            user: { include: { appUser: true } },
            seller: { include: { appUser: true } },
            operatorOffer: {
                select: { commissionRate: true, referralCommissionRate: true },
            },
        },
    });

    if (!order || !isSuccessfulOrder(order)) {
        return { agent: null, referral: null };
    }

    const actorType = classifyOrderActor(order.sellerId, order.userId);

    const intent = resolveCommissionIntent({
        actorType,
        sellerCanEarn: order.seller?.appUser?.canEarn ?? false,
        agentCommissionAmount: order.commissionAmount,
        referralCommissionAmount: order.referralCommissionAmount,
    });

    let agent = null;

    if (intent.agentAmount > 0 && order.sellerId && order.seller?.appUser) {
        agent = await EarningService.createEarning(tx, {
            program: EarningProgram.AGENT,
            appUserId: order.seller.appUser.id,
            userId: order.sellerId,
            amountCents: toMoneyCents(intent.agentAmount),
            baseAmountCents: toMoneyCents(order.totalAmount),
            // Rule snapshot: the offer's configured agent commission rate at the
            // moment the order was completed, frozen so a later offer edit cannot
            // rewrite this earning.
            rule: {
                scope: EarningRuleScope.OPERATOR_OFFER,
                ruleType: EarningRuleType.PERCENTAGE,
                value: order.operatorOffer?.commissionRate ?? 0,
                refId: order.operatorOfferId,
            },
            idempotencyKey: agentSaleIdempotencyKey(orderId, order.seller.appUser.id),
            orderId,
            description: `Agent sales commission for order ${orderId}`,
        });
    }

    const referrerAppUserId = order.user.appUser?.referredBy ?? null;

    let referral = null;

    if (intent.referralAmount > 0 && referrerAppUserId) {
        referral = await ReferralIncomeService.grantReferralIncome(tx, {
            appUserId: referrerAppUserId,
            orderId,
            amount: intent.referralAmount,
            baseAmount: order.totalAmount,
            ruleValue: order.operatorOffer?.referralCommissionRate ?? 0,
            offerId: order.operatorOfferId,
        });
    }

    // The referred buyer's qualifying purchase can also complete their referrer's
    // one-time milestone. Evaluated independently of whether a commission was
    // payable, because the milestone counts ACTIVE referrals, not commissions.
    if (referrerAppUserId) {
        await ReferralService.evaluateMilestoneReward(tx, referrerAppUserId);
    }

    return { agent, referral };
};

// Reverse any commission already credited for an order (cancellation, failure or
// refund). Compensating DEBIT entries are appended; nothing is mutated or deleted.
// Idempotent: an already-reversed credit is left untouched.
//
// The matching earning-ledger rows are frozen without a second wallet movement,
// because this function already appended the compensating debit itself.
const revokeOrderCommissions = async (
    tx: Prisma.TransactionClient,
    orderId: string,
) => {
    const credits = await tx.walletTransaction.findMany({
        where: {
            orderId,
            type: WalletTransactionType.CREDIT,
            reason: {
                in: [
                    WalletTransactionReason.COMMISSION,
                    WalletTransactionReason.REFERRAL_INCOME,
                ],
            },
        },
    });

    const reversals = [];

    for (const credit of credits) {
        const alreadyReversed = await tx.walletTransaction.findFirst({
            where: {
                orderId,
                userId: credit.userId,
                type: WalletTransactionType.DEBIT,
                reason: WalletTransactionReason.ADJUSTMENT,
            },
        });

        if (alreadyReversed) {
            continue;
        }

        const appUser = await tx.appUser.findUniqueOrThrow({
            where: { authUserId: credit.userId },
        });

        const balanceAfter = appUser.balance - credit.amount;

        if (balanceAfter < 0) {
            throw new AppError(
                status.BAD_REQUEST,
                "Insufficient wallet balance to reverse the commission",
            );
        }

        await tx.appUser.update({
            where: { authUserId: credit.userId },
            data: {
                balance: balanceAfter,
                totalEarned: appUser.totalEarned - credit.amount,
            },
        });

        reversals.push(
            await tx.walletTransaction.create({
                data: {
                    userId: credit.userId,
                    type: WalletTransactionType.DEBIT,
                    reason: WalletTransactionReason.ADJUSTMENT,
                    amount: credit.amount,
                    balanceAfter,
                    description: `Reversal of ${credit.reason} for order ${orderId}`,
                    orderId,
                },
            }),
        );
    }

    // Freeze the ledger rows so the earning history reflects the reversal without
    // moving the balance a second time.
    await EarningService.markEarningsReversedForSource(tx, { orderId });

    return reversals;
};

export const CommissionService = {
    settleOrderCommissions,
    revokeOrderCommissions,
};
