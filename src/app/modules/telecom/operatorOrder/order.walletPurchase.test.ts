import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    OrderStatus,
    PaymentStatus,
    WalletTransactionReason,
    WalletTransactionType,
} from "../../../../generated/prisma/enums";

const mocks = vi.hoisted(() => ({
    orderFindUnique: vi.fn(),
    orderCreate: vi.fn(),
    orderUpdateMany: vi.fn(),
    orderFindUniqueOrThrow: vi.fn(),
    offerFindFirst: vi.fn(),
    appUserFindUniqueOrThrow: vi.fn(),
    appUserUpdateMany: vi.fn(),
    walletCreate: vi.fn(),
    walletFindFirst: vi.fn(),
}));

vi.mock("../../../lib/prisma", () => {
    const tx = {
        order: {
            findUnique: mocks.orderFindUnique,
            create: mocks.orderCreate,
            updateMany: mocks.orderUpdateMany,
            findUniqueOrThrow: mocks.orderFindUniqueOrThrow,
        },
        operatorOffer: { findFirst: mocks.offerFindFirst },
        appUser: {
            findUniqueOrThrow: mocks.appUserFindUniqueOrThrow,
            updateMany: mocks.appUserUpdateMany,
        },
        walletTransaction: {
            create: mocks.walletCreate,
            findFirst: mocks.walletFindFirst,
        },
    };

    return {
        prisma: {
            $transaction: (callback: (client: typeof tx) => unknown) => callback(tx),
            order: { findUnique: mocks.orderFindUnique },
            walletTransaction: { findFirst: mocks.walletFindFirst },
        },
    };
});

import { OrderService } from "./order.service";

const user = { userId: "user-1" } as never;

const offer = {
    id: "offer-1",
    price: 100,
    isActive: true,
    isDeleted: false,
    commissionRate: 10,
    referralCommissionRate: 2,
};

beforeEach(() => {
    vi.clearAllMocks();
    mocks.offerFindFirst.mockResolvedValue(offer);
    mocks.orderFindUnique.mockResolvedValue(null);
    mocks.orderCreate.mockImplementation(
        async (args: { data: Record<string, unknown> }) => ({
            id: "order-gen",
            ...args.data,
        }),
    );
    mocks.orderUpdateMany.mockResolvedValue({ count: 1 });
    mocks.orderFindUniqueOrThrow.mockResolvedValue({
        id: "order-gen",
        paymentStatus: PaymentStatus.PAID,
        status: OrderStatus.PROCESSING,
    });
    mocks.appUserFindUniqueOrThrow
        .mockResolvedValueOnce({ balance: 1000, totalEarned: 0 })
        .mockResolvedValueOnce({ balance: 800 });
    mocks.appUserUpdateMany.mockResolvedValue({ count: 1 });
    mocks.walletCreate.mockImplementation(
        async (args: { data: Record<string, unknown> }) => ({
            id: "wt-1",
            ...args.data,
        }),
    );
    mocks.walletFindFirst.mockResolvedValue(null);
});

describe("OrderService.createOrderWithWallet", () => {
    it("creates the order and pays it from the wallet atomically", async () => {
        const result = await OrderService.createOrderWithWallet(
            { operatorOfferId: "offer-1", quantity: 2 },
            user,
        );

        // Order is created server-priced and PENDING before settlement.
        expect(mocks.orderCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    userId: "user-1",
                    sellerId: null,
                    operatorOfferId: "offer-1",
                    quantity: 2,
                    unitPrice: 100,
                    totalAmount: 200,
                    status: OrderStatus.PENDING,
                    paymentStatus: PaymentStatus.PENDING,
                }),
            }),
        );

        // Wallet is debited conditionally and the ledger row records the payment.
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
                    orderId: "order-gen",
                }),
            }),
        );

        expect(result.order.paymentStatus).toBe(PaymentStatus.PAID);
        expect(result.idempotent).toBe(false);
    });

    it("marks the order PROCESSING, never COMPLETED, when payment succeeds", async () => {
        const result = await OrderService.createOrderWithWallet(
            { operatorOfferId: "offer-1" },
            user,
        );

        expect(mocks.orderUpdateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                data: { paymentStatus: PaymentStatus.PAID, status: OrderStatus.PROCESSING },
            }),
        );
        expect(result.order.status).not.toBe(OrderStatus.COMPLETED);
    });

    it("does not record a debit when the wallet balance is insufficient", async () => {
        mocks.appUserUpdateMany.mockResolvedValue({ count: 0 });

        await expect(
            OrderService.createOrderWithWallet({ operatorOfferId: "offer-1" }, user),
        ).rejects.toThrow("Insufficient wallet balance");

        expect(mocks.walletCreate).not.toHaveBeenCalled();
    });

    it("rejects an offer that is not currently purchasable", async () => {
        mocks.offerFindFirst.mockResolvedValue(null);

        await expect(
            OrderService.createOrderWithWallet({ operatorOfferId: "missing" }, user),
        ).rejects.toThrow("Offer not found or not available");

        expect(mocks.orderCreate).not.toHaveBeenCalled();
    });

    it("refuses to spend the wallet on behalf of another user", async () => {
        await expect(
            OrderService.createOrderWithWallet(
                { operatorOfferId: "offer-1", buyerId: "someone-else" },
                user,
            ),
        ).rejects.toThrow("Wallet purchases cannot be made on behalf of another user");

        expect(mocks.offerFindFirst).not.toHaveBeenCalled();
        expect(mocks.orderCreate).not.toHaveBeenCalled();
    });

    it("resolves a retried idempotency key to the original order without recharging", async () => {
        const existing = {
            id: "order-original",
            userId: "user-1",
            paymentStatus: PaymentStatus.PAID,
            status: OrderStatus.PROCESSING,
            operatorOffer: offer,
        };
        const existingLedger = { id: "wt-original", orderId: "order-original" };
        mocks.orderFindUnique.mockResolvedValue(existing);
        mocks.walletFindFirst.mockResolvedValue(existingLedger);

        const result = await OrderService.createOrderWithWallet(
            { operatorOfferId: "offer-1", idempotencyKey: "retry-123" },
            user,
        );

        expect(result.idempotent).toBe(true);
        expect(result.order).toBe(existing);
        expect(result.walletTransaction).toBe(existingLedger);
        expect(mocks.orderCreate).not.toHaveBeenCalled();
        expect(mocks.appUserUpdateMany).not.toHaveBeenCalled();
        expect(mocks.walletCreate).not.toHaveBeenCalled();
    });

    it("derives a stable order id when an idempotency key is supplied", async () => {
        await OrderService.createOrderWithWallet(
            { operatorOfferId: "offer-1", idempotencyKey: "retry-abc" },
            user,
        );
        const firstId = mocks.orderCreate.mock.calls[0][0].data.id as string;

        vi.clearAllMocks();
        mocks.offerFindFirst.mockResolvedValue(offer);
        mocks.orderFindUnique.mockResolvedValue(null);
        mocks.orderCreate.mockImplementation(
            async (args: { data: Record<string, unknown> }) => ({ id: "x", ...args.data }),
        );
        mocks.orderUpdateMany.mockResolvedValue({ count: 1 });
        mocks.orderFindUniqueOrThrow.mockResolvedValue({ id: "x" });
        mocks.appUserFindUniqueOrThrow
            .mockResolvedValueOnce({ balance: 1000, totalEarned: 0 })
            .mockResolvedValueOnce({ balance: 900 });
        mocks.appUserUpdateMany.mockResolvedValue({ count: 1 });
        mocks.walletCreate.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
            id: "wt",
            ...args.data,
        }));

        await OrderService.createOrderWithWallet(
            { operatorOfferId: "offer-1", idempotencyKey: "retry-abc" },
            user,
        );
        const secondId = mocks.orderCreate.mock.calls[0][0].data.id as string;

        expect(firstId).toBeTruthy();
        expect(secondId).toBe(firstId);
    });
});
