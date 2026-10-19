import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    AgentApplicationStatus,
    EarningProgram,
    EarningStatus,
    OrderStatus,
    PaymentStatus,
} from "../../../../../generated/prisma/enums";
import { AgentService } from "./agent.service";

const mocks = vi.hoisted(() => ({
    appUserFindUnique: vi.fn(),
    orderAggregate: vi.fn(),
    groupBy: vi.fn(),
}));

vi.mock("../../../../lib/prisma", () => ({
    prisma: {
        appUser: { findUnique: mocks.appUserFindUnique },
        order: { aggregate: mocks.orderAggregate },
        earningTransaction: { groupBy: mocks.groupBy },
    },
}));

const requestUser = { userId: "u-1", role: "USER", email: "u@x.com" };

beforeEach(() => {
    vi.resetAllMocks();
    mocks.orderAggregate.mockResolvedValue({
        _count: { _all: 0 },
        _sum: { totalAmount: null, commissionAmount: null },
    });
    mocks.groupBy.mockResolvedValue([]);
});

describe("getAgentDashboard", () => {
    it("reports a pending application with no figures yet", async () => {
        mocks.appUserFindUnique.mockResolvedValue({
            id: "app-1",
            canEarn: false,
            balance: 0,
            totalEarned: 0,
            agentApplication: {
                status: AgentApplicationStatus.PENDING,
                appliedAt: new Date("2026-10-01"),
                reviewedAt: null,
                rejectionReason: null,
            },
        });

        const dashboard = await AgentService.getAgentDashboard(requestUser as never);

        expect(dashboard.program).toBe("AGENT");
        expect(dashboard.approved).toBe(false);
        expect(dashboard.canEarn).toBe(false);
        expect(dashboard.application.status).toBe(AgentApplicationStatus.PENDING);
        expect(dashboard.sales).toEqual({
            completedOrders: 0,
            totalSales: 0,
            totalCommission: 0,
        });
        expect(dashboard.earnings).toEqual({
            pending: 0,
            available: 0,
            reversed: 0,
        });
    });

    it("counts only delivered and paid sales for the caller", async () => {
        mocks.appUserFindUnique.mockResolvedValue({
            id: "app-1",
            canEarn: true,
            balance: 250,
            totalEarned: 300,
            agentApplication: {
                status: AgentApplicationStatus.APPROVED,
                appliedAt: new Date("2026-09-01"),
                reviewedAt: new Date("2026-09-02"),
                rejectionReason: null,
            },
        });
        mocks.orderAggregate.mockResolvedValue({
            _count: { _all: 3 },
            _sum: { totalAmount: 1_500, commissionAmount: 150 },
        });
        mocks.groupBy.mockResolvedValue([
            {
                status: EarningStatus.PENDING,
                _sum: { amount: 50 },
            },
            {
                status: EarningStatus.AVAILABLE,
                _sum: { amount: 300 },
            },
        ]);

        const dashboard = await AgentService.getAgentDashboard(requestUser as never);

        // Commission is only ever derived from a COMPLETED + PAID sale.
        expect(mocks.orderAggregate).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    sellerId: "u-1",
                    status: OrderStatus.COMPLETED,
                    paymentStatus: PaymentStatus.PAID,
                }),
            }),
        );
        // The earning ledger query is scoped to the caller's own AGENT earnings.
        expect(mocks.groupBy).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { program: EarningProgram.AGENT, appUserId: "app-1" },
            }),
        );

        expect(dashboard.approved).toBe(true);
        expect(dashboard.canEarn).toBe(true);
        expect(dashboard.sales).toEqual({
            completedOrders: 3,
            totalSales: 1_500,
            totalCommission: 150,
        });
        // Pending money is reported, but never as spendable balance.
        expect(dashboard.earnings).toEqual({
            pending: 50,
            available: 300,
            reversed: 0,
        });
        expect(dashboard.wallet).toEqual({ balance: 250, totalEarned: 300 });
    });

    it("reports zero when the caller has no Agent application", async () => {
        mocks.appUserFindUnique.mockResolvedValue({
            id: "app-1",
            canEarn: false,
            balance: 0,
            totalEarned: 0,
            agentApplication: null,
        });

        const dashboard = await AgentService.getAgentDashboard(requestUser as never);

        expect(dashboard.application.status).toBeNull();
        expect(dashboard.approved).toBe(false);
    });

    it("reports a rejected application with the reason and keeps the figures at zero", async () => {
        mocks.appUserFindUnique.mockResolvedValue({
            id: "app-1",
            canEarn: false,
            balance: 0,
            totalEarned: 0,
            agentApplication: {
                status: AgentApplicationStatus.REJECTED,
                appliedAt: new Date("2026-10-01"),
                reviewedAt: new Date("2026-10-03"),
                rejectionReason: "Incomplete details",
            },
        });

        const dashboard = await AgentService.getAgentDashboard(requestUser as never);

        expect(dashboard.application.status).toBe(AgentApplicationStatus.REJECTED);
        expect(dashboard.application.rejectionReason).toBe("Incomplete details");
        expect(dashboard.approved).toBe(false);
        expect(dashboard.canEarn).toBe(false);
        expect(dashboard.sales.completedOrders).toBe(0);
    });

    it("fails when the account has no app user row", async () => {
        mocks.appUserFindUnique.mockResolvedValue(null);

        await expect(
            AgentService.getAgentDashboard(requestUser as never),
        ).rejects.toThrow();
    });
});
