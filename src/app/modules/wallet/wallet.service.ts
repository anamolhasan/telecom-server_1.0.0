import status from "http-status";
import { WalletTransaction } from "../../../generated/prisma/client";
import { WalletTransactionReason } from "../../../generated/prisma/enums";
import AppError from "../../errorHelpers/AppError";
import { IQueryParams, PrismaModelDelegate } from "../../interfaces/query.interface";
import { IRequestUser } from "../../interfaces/requestUser.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { IAdjustWalletPayload } from "./wallet.interface";
import { applyWalletTransaction } from "./wallet.utils";


const getMyWallet = async (user: IRequestUser) => {
    const appUser = await prisma.appUser.findUniqueOrThrow({
        where: { authUserId: user.userId },
        select: {
            balance: true,
            totalEarned: true,
            canEarn: true,
            referredBy: true,
        },
    });

    return appUser;
};

const getMyWalletTransactions = async (user: IRequestUser, query: IQueryParams) => {
    const queryBuilder = new QueryBuilder<WalletTransaction>(
        prisma.walletTransaction as unknown as PrismaModelDelegate,
        query,
        {
            filterableFields: ["type", "reason", "orderId", "withdrawalId"],
        },
    );

    return queryBuilder
        .filter()
        .where({ userId: user.userId })
        .sort()
        .paginate()
        .fields()
        .execute();
};

const adjustWallet = async (payload: IAdjustWalletPayload) => {
    const appUser = await prisma.appUser.findFirst({
        where: { authUserId: payload.userId },
    });

    if (!appUser) {
        throw new AppError(status.NOT_FOUND, "App user not found");
    }

    return prisma.$transaction(async (tx) => {
        return applyWalletTransaction(tx, {
            userId: payload.userId,
            amount: payload.amount,
            type: payload.type,
            reason: payload.reason ?? WalletTransactionReason.ADJUSTMENT,
            description: payload.description ?? "Manual wallet adjustment",
        });
    });
};

export const WalletService = {
    getMyWallet,
    getMyWalletTransactions,
    adjustWallet,
};
