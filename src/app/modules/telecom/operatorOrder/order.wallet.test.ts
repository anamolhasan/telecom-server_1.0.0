import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    OrderStatus,
    PaymentStatus,
    WalletTransactionReason,
    WalletTransactionType,
} from "../../../../generated/prisma/enums";

const mocks = vi.hoisted(() => ({
    orderFindUnique: vi.fn(),
    orderUpdateMany: vi.fn(),
    orderFindUniqueOrThrow: vi.fn(),
    appUserFindUniqueOrThrow: vi.fn(),
    appUserUpdateMany: vi.fn(),
    walletCreate: vi.fn(),
}));

vi.mock("../../../lib/prisma", () => {
    const tx = {
        order: {
            findUnique: mocks.orderFindUnique,
            updateMany: mocks.orderUpdateMany,
            findUniqueOrThrow: mocks.orderFindUniqueOrThrow,
        },
        appUser: {
            findUniqueOrThrow: mocks.appUserFindUniqueOrThrow,
            updateMany: mocks.appUserUpdateMany,
        },
        walletTransaction: { create: mocks.walletCreate },
    };

    return {
        prisma: {
            $transaction: (callback: (client: typeof tx) => unknown) => callback(tx),
        },
    };
});

import { OrderService } from "./order.service";

const makeOrder = (overrides: Record<string, unknown> = {}) => ({
    id: "order-1",
    userId: "user-1",
    sellerId: null,
    operatorOfferId: "offer-1",
    quantity: 2,
    unitPrice: 100,
    totalAmount: 200,
    status: OrderStatus.PENDING,
    paymentStatus: PaymentStatus.PENDING,
    operatorOffer: {
        id: "offer-1",
        price: 100,
        isActive: true,
        isDeleted: false,
    },
    ...overrides,
});

const user = { userId: "user-1" } as never;

beforeEach(() => {
    vi.clearAllMocks();
    mocks.orderUpdateMany.mockResolvedValue({ count: 1 });
    mocks.appUserFindUniqueOrThrow.mockResolvedValue({ balance: 1000, totalEarned: 0 });
    mocks.appUserUpdateMany.mockResolvedValue({ count: 1 });
    mocks.orderFindUniqueOrThrow.mockResolvedValue(
        makeOrder({ status: OrderStatus.PROCESSING, paymentStatus: PaymentStatus.PAID }),
    );
    mocks.walletCreate.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
        id: "wt-1",
        ...args.data,
    }));
});

describe("OrderService.payOrderWithWallet", () => {
    it("debits the buyer wallet and records an ORDER_PAYMENT ledger entry", async () => {
        mocks.orderFindUnique.mockResolvedValue(makeOrder());
        mocks.appUserFindUniqueOrThrow
            .mockResolvedValueOnce({ balance: 1000, totalEarned: 0 })
            .mockResolvedValueOnce({ balance: 800 });

        const result = await OrderService.payOrderWithWallet("order-1", user);

        expect(mocks.appUserUpdateMany).toHaveBeenCalledWith({
            where: { authUserId: "user-1", balance: { gte: 200 } },
            data: { balance: { decrement: 200 } },
        });
        expect(mocks.walletCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    userId: "user-1",
                    amount: 200,
                    type: WalletTransactionType.DEBIT,
                    reason: WalletTransactionReason.ORDER_PAYMENT,
                    balanceAfter: 800,
                    orderId: "order-1",
                }),
            }),
        );
        expect(mocks.orderUpdateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ id: "order-1", userId: "user-1" }),
                data: {
                    paymentStatus: PaymentStatus.PAID,
                    status: OrderStatus.PROCESSING,
                },
            }),
        );
        expect(result.order.paymentStatus).toBe(PaymentStatus.PAID);
    });

    it("rejects an insufficient wallet balance without recording a debit", async () => {
        mocks.orderFindUnique.mockResolvedValue(makeOrder());
        mocks.appUserFindUniqueOrThrow.mockResolvedValueOnce({
            balance: 50,
            totalEarned: 0,
        });
        mocks.appUserUpdateMany.mockResolvedValue({ count: 0 });

        await expect(OrderService.payOrderWithWallet("order-1", user)).rejects.toThrow(
            "Insufficient wallet balance",
        );
        expect(mocks.walletCreate).not.toHaveBeenCalled();
    });

    it("does not debit twice when the order was already paid", async () => {
        mocks.orderFindUnique.mockResolvedValue(makeOrder());
        mocks.orderUpdateMany.mockResolvedValue({ count: 0 });

        await expect(OrderService.payOrderWithWallet("order-1", user)).rejects.toThrow(
            "Order is already paid",
        );
        expect(mocks.appUserUpdateMany).not.toHaveBeenCalled();
        expect(mocks.walletCreate).not.toHaveBeenCalled();
    });

    it("refuses to spend another user's wallet", async () => {
        mocks.orderFindUnique.mockResolvedValue(makeOrder({ userId: "someone-else" }));

        await expect(OrderService.payOrderWithWallet("order-1", user)).rejects.toThrow(
            "You can only pay for your own orders",
        );
        expect(mocks.orderUpdateMany).not.toHaveBeenCalled();
        expect(mocks.walletCreate).not.toHaveBeenCalled();
    });

    it("rejects a stale order whose stored total no longer matches the offer", async () => {
        mocks.orderFindUnique.mockResolvedValue(
            makeOrder({ operatorOffer: { id: "offer-1", price: 150, isActive: true, isDeleted: false } }),
        );

        await expect(OrderService.payOrderWithWallet("order-1", user)).rejects.toThrow(
            "Offer price has changed",
        );
        expect(mocks.orderUpdateMany).not.toHaveBeenCalled();
    });

    it("rejects an offer that is no longer purchasable", async () => {
        mocks.orderFindUnique.mockResolvedValue(
            makeOrder({ operatorOffer: { id: "offer-1", price: 100, isActive: false, isDeleted: false } }),
        );

        await expect(OrderService.payOrderWithWallet("order-1", user)).rejects.toThrow(
            "Offer not found or not available",
        );
        expect(mocks.orderUpdateMany).not.toHaveBeenCalled();
    });
});
