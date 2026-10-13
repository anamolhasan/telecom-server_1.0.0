import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "../../../generated/prisma/client";
import {
    OrderStatus,
    PaymentStatus,
    ReferralApplicationStatus,
    WalletTransactionReason,
    WalletTransactionType,
} from "../../../generated/prisma/enums";
import { CommissionService } from "./commission.service";

interface IOrderOverrides {
    sellerId?: string | null;
    sellerCanEarn?: boolean;
    referredBy?: string | null;
    status?: OrderStatus;
    paymentStatus?: PaymentStatus;
    commissionAmount?: number;
    referralCommissionAmount?: number;
}

const makeOrder = (overrides: IOrderOverrides = {}) => ({
    id: "order-1",
    userId: "buyer-1",
    sellerId: overrides.sellerId ?? null,
    commissionAmount: overrides.commissionAmount ?? 100,
    referralCommissionAmount: overrides.referralCommissionAmount ?? 10,
    status: overrides.status ?? OrderStatus.COMPLETED,
    paymentStatus: overrides.paymentStatus ?? PaymentStatus.PAID,
    user: {
        appUser: { id: "buyerApp", referredBy: overrides.referredBy ?? null },
    },
    seller: overrides.sellerId
        ? { appUser: { canEarn: overrides.sellerCanEarn ?? true } }
        : null,
});

interface ISettleOptions {
    existingCommission?: unknown;
    existingReferral?: unknown;
    referralApproved?: boolean;
}

const makeSettleTx = (
    order: ReturnType<typeof makeOrder>,
    options: ISettleOptions = {},
) => {
    const tx = {
        order: {
            findUnique: vi.fn().mockResolvedValue(order),
            groupBy: vi
                .fn()
                .mockResolvedValue([
                    { userId: "buyer-1" },
                    { userId: "referred-2" },
                    { userId: "referred-3" },
                ]),
        },
        walletTransaction: {
            findFirst: vi.fn((args: { where: { reason: WalletTransactionReason } }) => {
                if (args.where.reason === WalletTransactionReason.COMMISSION) {
                    return Promise.resolve(options.existingCommission ?? null);
                }
                if (args.where.reason === WalletTransactionReason.REFERRAL_INCOME) {
                    return Promise.resolve(options.existingReferral ?? null);
                }
                return Promise.resolve(null);
            }),
            create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
                id: "wt-new",
                ...args.data,
            })),
        },
        appUser: {
            findUniqueOrThrow: vi.fn(async (args: { where: { authUserId?: string; id?: string } }) => {
                const key = args.where.authUserId ?? args.where.id;
                if (key === "referrerApp") {
                    return { id: "referrerApp", authUserId: "referrer-user", balance: 0, totalEarned: 0 };
                }
                return { id: key, authUserId: key, balance: 0, totalEarned: 0 };
            }),
            findMany: vi
                .fn()
                .mockResolvedValue([{ authUserId: "b" }, { authUserId: "c" }, { authUserId: "d" }]),
            update: vi.fn().mockResolvedValue({}),
        },
        referralApplication: {
            findUnique: vi.fn().mockResolvedValue({
                status: options.referralApproved === false
                    ? ReferralApplicationStatus.PENDING
                    : ReferralApplicationStatus.APPROVED,
            }),
        },
    };

    return tx as unknown as Prisma.TransactionClient & {
        order: { findUnique: ReturnType<typeof vi.fn> };
        walletTransaction: { create: ReturnType<typeof vi.fn> };
    };
};

describe("settleOrderCommissions", () => {
    it("credits the agent commission to the seller for an authorised sale, with no referral", async () => {
        const tx = makeSettleTx(
            makeOrder({ sellerId: "seller-user", sellerCanEarn: true, referredBy: "referrerApp" }),
        );

        await CommissionService.settleOrderCommissions(tx, "order-1");

        expect(tx.walletTransaction.create).toHaveBeenCalledTimes(1);
        expect(tx.walletTransaction.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    userId: "seller-user",
                    reason: WalletTransactionReason.COMMISSION,
                    type: WalletTransactionType.CREDIT,
                    amount: 100,
                }),
            }),
        );
    });

    it("credits nothing for a sale by a seller without agent rights", async () => {
        const tx = makeSettleTx(
            makeOrder({ sellerId: "seller-user", sellerCanEarn: false, referredBy: "referrerApp" }),
        );

        await CommissionService.settleOrderCommissions(tx, "order-1");

        expect(tx.walletTransaction.create).not.toHaveBeenCalled();
    });

    it("credits the referral commission to an eligible referrer for a purchase", async () => {
        const tx = makeSettleTx(
            makeOrder({ sellerId: null, referredBy: "referrerApp", referralCommissionAmount: 10 }),
        );

        await CommissionService.settleOrderCommissions(tx, "order-1");

        expect(tx.walletTransaction.create).toHaveBeenCalledTimes(1);
        expect(tx.walletTransaction.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    userId: "referrer-user",
                    reason: WalletTransactionReason.REFERRAL_INCOME,
                    type: WalletTransactionType.CREDIT,
                    amount: 10,
                }),
            }),
        );
    });

    it("credits nothing for a purchase with no referrer", async () => {
        const tx = makeSettleTx(makeOrder({ sellerId: null, referredBy: null }));

        await CommissionService.settleOrderCommissions(tx, "order-1");

        expect(tx.walletTransaction.create).not.toHaveBeenCalled();
    });

    it("credits nothing for a purchase whose referrer is not eligible", async () => {
        const tx = makeSettleTx(
            makeOrder({ sellerId: null, referredBy: "referrerApp" }),
            { referralApproved: false },
        );

        await CommissionService.settleOrderCommissions(tx, "order-1");

        expect(tx.walletTransaction.create).not.toHaveBeenCalled();
    });

    it("credits nothing until the order is successful", async () => {
        const tx = makeSettleTx(
            makeOrder({
                sellerId: "seller-user",
                referredBy: "referrerApp",
                status: OrderStatus.PROCESSING,
                paymentStatus: PaymentStatus.PAID,
            }),
        );

        const result = await CommissionService.settleOrderCommissions(tx, "order-1");

        expect(result).toEqual({ agent: null, referral: null });
        expect(tx.walletTransaction.create).not.toHaveBeenCalled();
    });

    it("does not double-credit an agent sale", async () => {
        const tx = makeSettleTx(
            makeOrder({ sellerId: "seller-user", sellerCanEarn: true }),
            { existingCommission: { id: "wt-existing" } },
        );

        await CommissionService.settleOrderCommissions(tx, "order-1");

        expect(tx.walletTransaction.create).not.toHaveBeenCalled();
    });

    it("does not double-credit a referral purchase", async () => {
        const tx = makeSettleTx(
            makeOrder({ sellerId: null, referredBy: "referrerApp" }),
            { existingReferral: { id: "wt-existing" } },
        );

        await CommissionService.settleOrderCommissions(tx, "order-1");

        expect(tx.walletTransaction.create).not.toHaveBeenCalled();
    });

    it("returns nulls when the order does not exist", async () => {
        const tx = makeSettleTx(makeOrder());
        tx.order.findUnique.mockResolvedValue(null);

        const result = await CommissionService.settleOrderCommissions(tx, "missing");

        expect(result).toEqual({ agent: null, referral: null });
        expect(tx.walletTransaction.create).not.toHaveBeenCalled();
    });
});

interface IRevokeOptions {
    credits?: {
        id: string;
        userId: string;
        amount: number;
        reason: WalletTransactionReason;
    }[];
    alreadyReversed?: unknown;
    balance?: number;
    totalEarned?: number;
}

const makeRevokeTx = (options: IRevokeOptions = {}) => {
    const tx = {
        walletTransaction: {
            findMany: vi.fn().mockResolvedValue(options.credits ?? []),
            findFirst: vi.fn().mockResolvedValue(options.alreadyReversed ?? null),
            create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
                id: "reversal",
                ...args.data,
            })),
        },
        appUser: {
            findUniqueOrThrow: vi.fn().mockResolvedValue({
                id: "app",
                authUserId: "seller-user",
                balance: options.balance ?? 200,
                totalEarned: options.totalEarned ?? 100,
            }),
            update: vi.fn().mockResolvedValue({}),
        },
    };

    return tx as unknown as Prisma.TransactionClient & {
        appUser: { update: ReturnType<typeof vi.fn> };
        walletTransaction: { create: ReturnType<typeof vi.fn> };
    };
};

describe("revokeOrderCommissions", () => {
    it("appends a compensating debit for a credited commission", async () => {
        const tx = makeRevokeTx({
            credits: [
                { id: "c1", userId: "seller-user", amount: 100, reason: WalletTransactionReason.COMMISSION },
            ],
            balance: 200,
            totalEarned: 100,
        });

        const result = await CommissionService.revokeOrderCommissions(tx, "order-1");

        expect(result).toHaveLength(1);
        expect(tx.appUser.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: { balance: 100, totalEarned: 0 },
            }),
        );
        expect(tx.walletTransaction.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    userId: "seller-user",
                    reason: WalletTransactionReason.ADJUSTMENT,
                    type: WalletTransactionType.DEBIT,
                    amount: 100,
                    orderId: "order-1",
                }),
            }),
        );
    });

    it("is idempotent when the commission was already reversed", async () => {
        const tx = makeRevokeTx({
            credits: [
                { id: "c1", userId: "seller-user", amount: 100, reason: WalletTransactionReason.COMMISSION },
            ],
            alreadyReversed: { id: "reversal" },
        });

        const result = await CommissionService.revokeOrderCommissions(tx, "order-1");

        expect(result).toEqual([]);
        expect(tx.appUser.update).not.toHaveBeenCalled();
        expect(tx.walletTransaction.create).not.toHaveBeenCalled();
    });

    it("does nothing when no commissions were credited", async () => {
        const tx = makeRevokeTx({ credits: [] });

        const result = await CommissionService.revokeOrderCommissions(tx, "order-1");

        expect(result).toEqual([]);
        expect(tx.walletTransaction.create).not.toHaveBeenCalled();
    });

    it("refuses to reverse when the balance is insufficient", async () => {
        const tx = makeRevokeTx({
            credits: [
                { id: "c1", userId: "seller-user", amount: 100, reason: WalletTransactionReason.COMMISSION },
            ],
            balance: 40,
        });

        await expect(
            CommissionService.revokeOrderCommissions(tx, "order-1"),
        ).rejects.toThrow();
        expect(tx.walletTransaction.create).not.toHaveBeenCalled();
    });
});
