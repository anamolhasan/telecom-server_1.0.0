import status from "http-status";
import { Prisma } from "../../../generated/prisma/client";
import {
    WalletTransactionReason,
    WalletTransactionType,
} from "../../../generated/prisma/enums";
import AppError from "../../errorHelpers/AppError";
import { ReferralIncomeService } from "../referral/referral.income";
import { applyWalletTransaction } from "../wallet/wallet.utils";
import {
    classifyOrderActor,
    isSuccessfulOrder,
    resolveCommissionIntent,
} from "./commission.rule";

// Award the agent and/or referral commissions for a successful (COMPLETED + PAID)
// order. Idempotent: at most one COMMISSION and one REFERRAL_INCOME ledger row per
// order. Amounts come from the persisted, server-computed Order fields only; the
// eligibility of a referrer is re-derived live by grantReferralIncome.
const settleOrderCommissions = async (
    tx: Prisma.TransactionClient,
    orderId: string,
) => {
    const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
            user: { include: { appUser: true } },
            seller: { include: { appUser: true } },
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

    if (intent.agentAmount > 0 && order.sellerId) {
        const existing = await tx.walletTransaction.findFirst({
            where: { orderId, reason: WalletTransactionReason.COMMISSION },
        });

        if (!existing) {
            agent = await applyWalletTransaction(tx, {
                userId: order.sellerId,
                amount: intent.agentAmount,
                type: WalletTransactionType.CREDIT,
                reason: WalletTransactionReason.COMMISSION,
                description: `Agent sales commission for order ${orderId}`,
                orderId,
            });
        }
    }

    let referral = null;

    if (intent.referralAmount > 0) {
        const referrerAppUserId = order.user.appUser?.referredBy ?? null;

        if (referrerAppUserId) {
            referral = await ReferralIncomeService.grantReferralIncome(tx, {
                appUserId: referrerAppUserId,
                orderId,
                amount: intent.referralAmount,
            });
        }
    }

    return { agent, referral };
};

// Reverse any commission already credited for an order (cancellation, failure or
// refund). Compensating DEBIT entries are appended; nothing is mutated or deleted.
// Idempotent: an already-reversed credit is left untouched.
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

    return reversals;
};

export const CommissionService = {
    settleOrderCommissions,
    revokeOrderCommissions,
};
