import status from "http-status";
import {
    AgentApplicationStatus,
    EarningProgram,
    OrderStatus,
    PaymentStatus,
} from "../../../../../generated/prisma/enums";
import AppError from "../../../../errorHelpers/AppError";
import type {
    IQueryParams,
    PrismaModelDelegate,
} from "../../../../interfaces/query.interface";
import type { IRequestUser } from "../../../../interfaces/requestUser.interface";
import { prisma } from "../../../../lib/prisma";
import { QueryBuilder } from "../../../../utils/QueryBuilder";
import { toMoneyNumber } from "../../../ecommerce/ecommerce.utils";
import { summariseEarningGroups } from "../../../earning/earning.service";
import type { IAgentDashboard, IAgentSaleItem } from "./agent.interface";

const publicSale = (order: {
    id: string;
    operatorOfferId: string;
    targetNumber: string | null;
    quantity: number;
    unitPrice: unknown;
    totalAmount: unknown;
    commissionAmount: unknown;
    completedAt: Date | null;
    createdAt: Date;
}): IAgentSaleItem => ({
    orderId: order.id,
    operatorOfferId: order.operatorOfferId,
    targetNumber: order.targetNumber,
    quantity: order.quantity,
    unitPrice: toMoneyNumber(order.unitPrice),
    totalAmount: toMoneyNumber(order.totalAmount),
    commissionAmount: toMoneyNumber(order.commissionAmount),
    completedAt: order.completedAt,
    createdAt: order.createdAt,
});

// The Agent dashboard for the caller. Every figure is derived from rows the
// caller owns: their own application, orders they sold, and their own earning
// ledger rows. Nothing about another agent is reachable, and no commission
// configuration is returned.
const getAgentDashboard = async (user: IRequestUser): Promise<IAgentDashboard> => {
    const appUser = await prisma.appUser.findUnique({
        where: { authUserId: user.userId },
        select: {
            id: true,
            canEarn: true,
            balance: true,
            totalEarned: true,
            agentApplication: {
                select: {
                    status: true,
                    appliedAt: true,
                    reviewedAt: true,
                    rejectionReason: true,
                },
            },
        },
    });

    if (!appUser) {
        throw new AppError(status.NOT_FOUND, "App user not found");
    }

    const [salesAggregate, earningGroups] = await Promise.all([
        // Only a genuinely successful sale counts: delivered (COMPLETED) and paid.
        prisma.order.aggregate({
            where: {
                sellerId: user.userId,
                status: OrderStatus.COMPLETED,
                paymentStatus: PaymentStatus.PAID,
            },
            _count: { _all: true },
            _sum: { totalAmount: true, commissionAmount: true },
        }),
        prisma.earningTransaction.groupBy({
            by: ["status"],
            where: { program: EarningProgram.AGENT, appUserId: appUser.id },
            _sum: { amount: true },
        }),
    ]);

    const earnings = summariseEarningGroups(earningGroups);

    return {
        program: "AGENT",
        application: {
            status: appUser.agentApplication?.status ?? null,
            appliedAt: appUser.agentApplication?.appliedAt ?? null,
            reviewedAt: appUser.agentApplication?.reviewedAt ?? null,
            rejectionReason: appUser.agentApplication?.rejectionReason ?? null,
        },
        approved: appUser.agentApplication?.status === AgentApplicationStatus.APPROVED,
        canEarn: appUser.canEarn,
        sales: {
            completedOrders: salesAggregate._count._all,
            totalSales: toMoneyNumber(salesAggregate._sum.totalAmount),
            totalCommission: toMoneyNumber(salesAggregate._sum.commissionAmount),
        },
        earnings,
        wallet: {
            balance: toMoneyNumber(appUser.balance),
            totalEarned: toMoneyNumber(appUser.totalEarned),
        },
    };
};

// The caller's own completed sales. `sellerId` is forced to the session user after
// the client filters, so a query string can never reveal another agent's sales.
const getMySales = async (user: IRequestUser, query: IQueryParams) => {
    const result = await new QueryBuilder(
        prisma.order as unknown as PrismaModelDelegate,
        query,
        {
            searchableFields: ["targetNumber", "note"],
            filterableFields: ["operatorOfferId", "completedAt", "createdAt"],
        },
    )
        .search()
        .filter()
        .where({
            sellerId: user.userId,
            status: OrderStatus.COMPLETED,
            paymentStatus: PaymentStatus.PAID,
        })
        .sort()
        .paginate()
        .fields()
        .execute();

    return {
        ...result,
        data: (result.data as unknown as Parameters<typeof publicSale>[0][]).map(
            publicSale,
        ),
    };
};

export const AgentService = {
    getAgentDashboard,
    getMySales,
};
