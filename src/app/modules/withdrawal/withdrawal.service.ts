import status from "http-status";
import { Withdrawal } from "../../../generated/prisma/client";
import { WalletTransactionReason, WalletTransactionType, WithdrawalStatus } from "../../../generated/prisma/enums";
import { MIN_WITHDRAWAL_AMOUNT } from "../../constants/telecom.constant";
import AppError from "../../errorHelpers/AppError";
import { IQueryParams, PrismaModelDelegate } from "../../interfaces/query.interface";
import { IRequestUser } from "../../interfaces/requestUser.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { applyWalletTransaction } from "../wallet/wallet.utils";
import { ICreateWithdrawalPayload, IUpdateWithdrawalStatusPayload } from "./withdrawal.interface";


const WITHDRAWAL_STATUS_TRANSITIONS: Record<WithdrawalStatus, WithdrawalStatus[]> = {
    [WithdrawalStatus.PENDING]: [WithdrawalStatus.APPROVED, WithdrawalStatus.REJECTED],
    [WithdrawalStatus.APPROVED]: [WithdrawalStatus.PAID],
    [WithdrawalStatus.REJECTED]: [],
    [WithdrawalStatus.PAID]: [],
};

const requestWithdrawal = async (payload: ICreateWithdrawalPayload, user: IRequestUser) => {
    if (payload.amount < MIN_WITHDRAWAL_AMOUNT) {
        throw new AppError(status.BAD_REQUEST, `Minimum withdrawal amount is ${MIN_WITHDRAWAL_AMOUNT}`);
    }

    const appUser = await prisma.appUser.findUniqueOrThrow({
        where: { authUserId: user.userId },
    });

    if (appUser.balance < payload.amount) {
        throw new AppError(status.BAD_REQUEST, "Insufficient wallet balance");
    }

    return prisma.withdrawal.create({
        data: {
            userId: user.userId,
            amount: payload.amount,
            method: payload.method,
            accountNumber: payload.accountNumber,
            accountName: payload.accountName,
            status: WithdrawalStatus.PENDING,
        },
    });
};

const getMyWithdrawals = async (user: IRequestUser, query: IQueryParams) => {
    const queryBuilder = new QueryBuilder<Withdrawal>(
        prisma.withdrawal as unknown as PrismaModelDelegate,
        query,
        {
            filterableFields: ["status", "method"],
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

const getAllWithdrawals = async (query: IQueryParams) => {
    const queryBuilder = new QueryBuilder<Withdrawal>(
        prisma.withdrawal as unknown as PrismaModelDelegate,
        query,
        {
            searchableFields: ["accountNumber", "user.name", "user.email"],
            filterableFields: ["status", "method", "userId"],
        },
    );

    return queryBuilder
        .search()
        .filter()
        .include({ user: true })
        .sort()
        .paginate()
        .fields()
        .execute();
};

const updateWithdrawalStatus = async (
    id: string,
    payload: IUpdateWithdrawalStatusPayload,
    adminUser: IRequestUser,
) => {
    const withdrawal = await prisma.withdrawal.findUnique({ where: { id } });

    if (!withdrawal) {
        throw new AppError(status.NOT_FOUND, "Withdrawal not found");
    }

    const allowed = WITHDRAWAL_STATUS_TRANSITIONS[withdrawal.status];

    if (!allowed.includes(payload.status)) {
        throw new AppError(
            status.BAD_REQUEST,
            `Cannot change withdrawal status from ${withdrawal.status} to ${payload.status}`,
        );
    }

    return prisma.$transaction(async (tx) => {
        if (payload.status === WithdrawalStatus.APPROVED) {
            await applyWalletTransaction(tx, {
                userId: withdrawal.userId,
                amount: withdrawal.amount,
                type: WalletTransactionType.DEBIT,
                reason: WalletTransactionReason.WITHDRAWAL,
                description: `Withdrawal approved for request ${withdrawal.id}`,
                withdrawalId: withdrawal.id,
            });
        }

        return tx.withdrawal.update({
            where: { id },
            data: {
                status: payload.status,
                adminNote: payload.adminNote,
                processedById: adminUser.userId,
                processedAt: new Date(),
            },
        });
    });
};

export const WithdrawalService = {
    requestWithdrawal,
    getMyWithdrawals,
    getAllWithdrawals,
    updateWithdrawalStatus,
};
