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

    const balanceAfter =
        payload.type === WalletTransactionType.CREDIT
            ? appUser.balance + payload.amount
            : appUser.balance - payload.amount;

    if (balanceAfter < 0) {
        throw new AppError(status.BAD_REQUEST, "Insufficient wallet balance");
    }

    const shouldIncreaseEarned = EARNING_REASONS.includes(payload.reason);

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
