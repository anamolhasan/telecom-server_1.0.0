import status from "http-status";
import { Prisma } from "../../../generated/prisma/client";
import { WalletTransactionReason, WalletTransactionType } from "../../../generated/prisma/enums";
import AppError from "../../errorHelpers/AppError";


interface IApplyWalletTransaction {
    userId: string;
    amount: number;
    type: WalletTransactionType;
    reason: WalletTransactionReason;
    description?: string;
    orderId?: string;
    withdrawalId?: string;
}

const EARNING_REASONS: WalletTransactionReason[] = [
    WalletTransactionReason.COMMISSION,
    WalletTransactionReason.REFERRAL_INCOME,
    WalletTransactionReason.REFERRAL_MILESTONE,
    WalletTransactionReason.AFFILIATE_COMMISSION,
];

export const applyWalletTransaction = async (
    tx: Prisma.TransactionClient,
    payload: IApplyWalletTransaction,
) => {
    const appUser = await tx.appUser.findUniqueOrThrow({
        where: {
            authUserId: payload.userId,
        },
    });

    if (payload.type === WalletTransactionType.DEBIT) {
        // The balance check and the decrement are a single conditional statement,
        // so concurrent debits can never overdraw the wallet (no read-then-write
        // race). A zero count means the balance was insufficient.
        const result = await tx.appUser.updateMany({
            where: {
                authUserId: payload.userId,
                balance: { gte: payload.amount },
            },
            data: { balance: { decrement: payload.amount } },
        });

        if (result.count === 0) {
            throw new AppError(status.BAD_REQUEST, "Insufficient wallet balance");
        }

        const { balance } = await tx.appUser.findUniqueOrThrow({
            where: { authUserId: payload.userId },
            select: { balance: true },
        });

        return tx.walletTransaction.create({
            data: {
                userId: payload.userId,
                type: payload.type,
                reason: payload.reason,
                amount: payload.amount,
                balanceAfter: balance,
                description: payload.description,
                orderId: payload.orderId,
                withdrawalId: payload.withdrawalId,
            },
        });
    }

    const shouldIncreaseEarned = EARNING_REASONS.includes(payload.reason);
    const balanceAfter = appUser.balance + payload.amount;

    await tx.appUser.update({
        where: {
            authUserId: payload.userId,
        },
        data: {
            balance: balanceAfter,
            ...(shouldIncreaseEarned && payload.type === WalletTransactionType.CREDIT
                ? { totalEarned: appUser.totalEarned + payload.amount }
                : {}),
        },
    });

    return tx.walletTransaction.create({
        data: {
            userId: payload.userId,
            type: payload.type,
            reason: payload.reason,
            amount: payload.amount,
            balanceAfter,
            description: payload.description,
            orderId: payload.orderId,
            withdrawalId: payload.withdrawalId,
        },
    });
};
