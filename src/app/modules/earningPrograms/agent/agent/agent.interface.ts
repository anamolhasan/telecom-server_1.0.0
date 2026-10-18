import type { AgentApplicationStatus } from "../../../../../generated/prisma/enums";

// The Agent dashboard is derived entirely server-side. It reports the caller's own
// application state, sales and earnings; no commission configuration (rates,
// rules or rule snapshots of other agents) is ever exposed here.
export interface IAgentDashboard {
    program: "AGENT";
    application: {
        status: AgentApplicationStatus | null;
        appliedAt: Date | null;
        reviewedAt: Date | null;
        rejectionReason: string | null;
    };
    approved: boolean;
    // The reseller feature flag derived from the APPROVED application.
    canEarn: boolean;
    sales: {
        completedOrders: number;
        totalSales: number;
        totalCommission: number;
    };
    earnings: {
        pending: number;
        available: number;
        reversed: number;
    };
    wallet: {
        balance: number;
        totalEarned: number;
    };
}

export interface IAgentSaleItem {
    orderId: string;
    operatorOfferId: string;
    targetNumber: string | null;
    quantity: number;
    unitPrice: number;
    totalAmount: number;
    commissionAmount: number;
    completedAt: Date | null;
    createdAt: Date;
}
