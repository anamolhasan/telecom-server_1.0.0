import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import {
    OrderStatus,
    PaymentStatus,
    WebhookEventStatus,
} from "../../../generated/prisma/enums";

const mocks = vi.hoisted(() => ({
    webhookCreate: vi.fn(),
    webhookUpdateMany: vi.fn(),
    paymentFindFirst: vi.fn(),
    paymentUpdate: vi.fn(),
    orderFindUnique: vi.fn(),
    orderUpdate: vi.fn(),
    settleCommissions: vi.fn(),
}));

vi.mock("../../lib/prisma", () => {
    const tx = {
        payment: {
            findFirst: mocks.paymentFindFirst,
            update: mocks.paymentUpdate,
        },
        order: {
            findUnique: mocks.orderFindUnique,
            update: mocks.orderUpdate,
        },
    };

    return {
        prisma: {
            webhookEvent: {
                create: mocks.webhookCreate,
                updateMany: mocks.webhookUpdateMany,
            },
            $transaction: (callback: (client: typeof tx) => unknown) => callback(tx),
        },
    };
});

vi.mock("../commission/commission.service", () => ({
    CommissionService: { settleOrderCommissions: mocks.settleCommissions },
}));

import { PaymentService } from "./payment.service";

const makePayment = (overrides: Record<string, unknown> = {}) => ({
    id: "payment-1",
    orderId: "order-1",
    userId: "user-1",
    amount: 200,
    currency: "bdt",
    status: PaymentStatus.PENDING,
    ...overrides,
});

const makeOrder = (overrides: Record<string, unknown> = {}) => ({
    id: "order-1",
    userId: "user-1",
    totalAmount: 200,
    status: OrderStatus.PENDING,
    ...overrides,
});

const makeSession = (overrides: Record<string, unknown> = {}) => ({
    id: "cs_test_1",
    payment_status: "paid",
    amount_total: 20000,
    currency: "bdt",
    metadata: { orderId: "order-1", paymentId: "payment-1" },
    ...overrides,
});

const makeEvent = (
    session: ReturnType<typeof makeSession>,
    overrides: Record<string, unknown> = {},
) =>
    ({
        id: "evt_1",
        type: "checkout.session.completed",
        data: { object: session },
        ...overrides,
    }) as unknown as Stripe.Event;

beforeEach(() => {
    vi.clearAllMocks();
    mocks.webhookCreate.mockResolvedValue({ id: "wh-1" });
    mocks.webhookUpdateMany.mockResolvedValue({ count: 1 });
    mocks.paymentFindFirst.mockResolvedValue(makePayment());
    mocks.paymentUpdate.mockResolvedValue({});
    mocks.orderFindUnique.mockResolvedValue(makeOrder());
    mocks.orderUpdate.mockResolvedValue({});
    mocks.settleCommissions.mockResolvedValue({ agent: null, referral: null });
});

describe("PaymentService.handleStripeWebhookEvent", () => {
    it("marks the order paid and settles commissions for a verified payment", async () => {
        const result = await PaymentService.handleStripeWebhookEvent(makeEvent(makeSession()));

        expect(result.message).toBe("Payment completed successfully");
        expect(mocks.paymentUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ status: PaymentStatus.PAID }),
            }),
        );
        expect(mocks.orderUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: { status: OrderStatus.PROCESSING, paymentStatus: PaymentStatus.PAID },
            }),
        );
        expect(mocks.settleCommissions).toHaveBeenCalledTimes(1);
        expect(mocks.webhookUpdateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ status: WebhookEventStatus.PROCESSED }),
            }),
        );
    });

    it("rejects when the Stripe amount does not match the order total", async () => {
        const event = makeEvent(makeSession({ amount_total: 100 }));

        await expect(PaymentService.handleStripeWebhookEvent(event)).rejects.toThrow(
            "Stripe amount does not match order total",
        );
        expect(mocks.paymentUpdate).not.toHaveBeenCalled();
        expect(mocks.orderUpdate).not.toHaveBeenCalled();
    });

    it("rejects when the stored payment amount does not match the order total", async () => {
        mocks.paymentFindFirst.mockResolvedValue(makePayment({ amount: 999 }));

        await expect(
            PaymentService.handleStripeWebhookEvent(makeEvent(makeSession())),
        ).rejects.toThrow("Payment amount does not match order total");
        expect(mocks.paymentUpdate).not.toHaveBeenCalled();
    });

    it("rejects when the Stripe currency does not match the payment currency", async () => {
        const event = makeEvent(makeSession({ currency: "usd" }));

        await expect(PaymentService.handleStripeWebhookEvent(event)).rejects.toThrow(
            "Stripe currency does not match payment currency",
        );
        expect(mocks.paymentUpdate).not.toHaveBeenCalled();
    });

    it("rejects when the payment is not associated with the order", async () => {
        mocks.paymentFindFirst.mockResolvedValue(makePayment({ orderId: "other-order" }));

        await expect(
            PaymentService.handleStripeWebhookEvent(makeEvent(makeSession())),
        ).rejects.toThrow("not associated with this order/payment");
        expect(mocks.paymentUpdate).not.toHaveBeenCalled();
    });

    it("rejects a session that is missing order/payment metadata", async () => {
        const event = makeEvent(makeSession({ metadata: {} }));

        await expect(PaymentService.handleStripeWebhookEvent(event)).rejects.toThrow(
            "Missing order/payment metadata",
        );
        expect(mocks.paymentUpdate).not.toHaveBeenCalled();
    });

    it("does not mark an unpaid checkout session as paid", async () => {
        const result = await PaymentService.handleStripeWebhookEvent(
            makeEvent(makeSession({ payment_status: "unpaid" })),
        );

        expect(result.message).toContain("not paid yet");
        expect(mocks.paymentFindFirst).not.toHaveBeenCalled();
        expect(mocks.paymentUpdate).not.toHaveBeenCalled();
        expect(mocks.orderUpdate).not.toHaveBeenCalled();
    });

    it("is a no-op when the payment is already paid", async () => {
        mocks.paymentFindFirst.mockResolvedValue(makePayment({ status: PaymentStatus.PAID }));

        const result = await PaymentService.handleStripeWebhookEvent(makeEvent(makeSession()));

        expect(result.message).toBe("Payment completed successfully");
        expect(mocks.paymentUpdate).not.toHaveBeenCalled();
        expect(mocks.settleCommissions).not.toHaveBeenCalled();
    });

    it("skips a duplicate delivery of an already-processed event", async () => {
        mocks.webhookCreate.mockRejectedValue({ code: "P2002" });
        mocks.webhookUpdateMany.mockResolvedValueOnce({ count: 0 });

        const result = await PaymentService.handleStripeWebhookEvent(makeEvent(makeSession()));

        expect(result.message).toBe("Event already processed");
        expect(mocks.paymentUpdate).not.toHaveBeenCalled();
        expect(mocks.orderUpdate).not.toHaveBeenCalled();
    });

    it("reprocesses an event Stripe retries after a previous failure", async () => {
        mocks.webhookCreate.mockRejectedValue({ code: "P2002" });
        mocks.webhookUpdateMany.mockResolvedValueOnce({ count: 1 });

        const result = await PaymentService.handleStripeWebhookEvent(makeEvent(makeSession()));

        expect(result.message).toBe("Payment completed successfully");
        expect(mocks.paymentUpdate).toHaveBeenCalledTimes(1);
        expect(mocks.settleCommissions).toHaveBeenCalledTimes(1);
    });

    it("marks the event FAILED and rethrows when processing fails", async () => {
        mocks.paymentFindFirst.mockResolvedValue(makePayment({ orderId: "other-order" }));

        await expect(
            PaymentService.handleStripeWebhookEvent(makeEvent(makeSession())),
        ).rejects.toThrow("not associated with this order/payment");

        expect(mocks.webhookUpdateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    status: WebhookEventStatus.FAILED,
                    error: "Stripe session is not associated with this order/payment",
                }),
            }),
        );
    });
});
