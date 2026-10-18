import status from "http-status";
import Stripe from "stripe";
import { Prisma } from "../../../generated/prisma/client";
import {
    OrderStatus,
    PaymentStatus,
    WebhookEventStatus,
} from "../../../generated/prisma/enums";
import AppError from "../../errorHelpers/AppError";
import { prisma } from "../../lib/prisma";
import { CommissionService } from "../commission/commission.service";


const STRIPE_PROVIDER = "stripe";

const isUniqueConstraintError = (error: unknown): boolean =>
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "P2002";

// Stripe reports monetary amounts in the currency's minor unit (poisha for BDT),
// while orders/payments store the major unit. Compare both sides in minor units.
const toMinorUnits = (amount: number): number => Math.round(amount * 100);

// Claim a provider event before processing it. A freshly inserted row is ours to
// handle; a duplicate delivery of a row that is PROCESSING (another delivery in
// flight) or PROCESSED (already handled) is skipped. Only a row a previous
// attempt left FAILED may be retried.
const claimWebhookEvent = async (
    provider: string,
    eventId: string,
    type: string,
): Promise<boolean> => {
    try {
        await prisma.webhookEvent.create({
            data: { provider, eventId, type, status: WebhookEventStatus.PROCESSING },
        });

        return true;
    } catch (error) {
        if (!isUniqueConstraintError(error)) {
            throw error;
        }

        const claimed = await prisma.webhookEvent.updateMany({
            where: { provider, eventId, status: WebhookEventStatus.FAILED },
            data: { status: WebhookEventStatus.PROCESSING, error: null },
        });

        return claimed.count > 0;
    }
};

const markWebhookEventProcessed = async (provider: string, eventId: string) => {
    await prisma.webhookEvent.updateMany({
        where: { provider, eventId },
        data: { status: WebhookEventStatus.PROCESSED, error: null, processedAt: new Date() },
    });
};

const markWebhookEventFailed = async (
    provider: string,
    eventId: string,
    error: unknown,
) => {
    const message = error instanceof Error ? error.message : String(error);

    await prisma.webhookEvent.updateMany({
        where: { provider, eventId },
        data: { status: WebhookEventStatus.FAILED, error: message },
    });
};

const markPaymentFailed = async (event: Stripe.Event, session: Stripe.Checkout.Session) => {
    const paymentId = session.metadata?.paymentId;

    if (!paymentId) {
        return;
    }

    await prisma.$transaction(async (tx) => {
        const payment = await tx.payment.findFirst({ where: { id: paymentId } });

        if (!payment || payment.status === PaymentStatus.PAID) {
            return;
        }

        await tx.payment.update({
            where: { id: paymentId },
            data: { status: PaymentStatus.FAILED, stripeEventId: event.id },
        });

        await tx.order.update({
            where: { id: payment.orderId },
            data: { status: OrderStatus.FAILED, paymentStatus: PaymentStatus.FAILED },
        });
    });
};

const handleCheckoutCompleted = async (event: Stripe.Event, session: Stripe.Checkout.Session) => {
    // A completed checkout is only a settled payment once Stripe reports it paid.
    // Delayed payment methods can complete the session while still unpaid.
    if (session.payment_status !== "paid") {
        return { message: "Checkout session is not paid yet; payment not confirmed" };
    }

    const orderId = session.metadata?.orderId;
    const paymentId = session.metadata?.paymentId;

    if (!orderId || !paymentId) {
        throw new AppError(status.BAD_REQUEST, "Missing order/payment metadata in Stripe session");
    }

    await prisma.$transaction(async (tx) => {
        const payment = await tx.payment.findFirst({ where: { id: paymentId } });

        if (!payment) {
            throw new AppError(status.NOT_FOUND, "Payment not found");
        }

        if (payment.status === PaymentStatus.PAID) {
            return;
        }

        const order = await tx.order.findUnique({ where: { id: orderId } });

        if (!order) {
            throw new AppError(status.NOT_FOUND, "Order not found");
        }

        // The session metadata, the payment row and the order row must all agree.
        if (payment.orderId !== order.id || payment.userId !== order.userId) {
            throw new AppError(
                status.BAD_REQUEST,
                "Stripe session is not associated with this order/payment",
            );
        }

        const expectedMinor = toMinorUnits(order.totalAmount);

        if (toMinorUnits(payment.amount) !== expectedMinor) {
            throw new AppError(status.BAD_REQUEST, "Payment amount does not match order total");
        }

        if (session.amount_total !== expectedMinor) {
            throw new AppError(status.BAD_REQUEST, "Stripe amount does not match order total");
        }

        if ((session.currency ?? "").toLowerCase() !== payment.currency.toLowerCase()) {
            throw new AppError(
                status.BAD_REQUEST,
                "Stripe currency does not match payment currency",
            );
        }

        await tx.payment.update({
            where: { id: paymentId },
            data: {
                status: PaymentStatus.PAID,
                stripeEventId: event.id,
                paidAt: new Date(),
                paymentGatewayData: JSON.parse(JSON.stringify(session)) as Prisma.InputJsonValue,
            },
        });

        await tx.order.update({
            where: { id: orderId },
            data: {
                // Never regress an order that has already moved past PENDING.
                ...(order.status === OrderStatus.PENDING
                    ? { status: OrderStatus.PROCESSING }
                    : {}),
                paymentStatus: PaymentStatus.PAID,
            },
        });

        // Awards only materialise once the order is both COMPLETED and PAID. This
        // also covers the case where an order was completed before it was paid.
        await CommissionService.settleOrderCommissions(tx, orderId);
    });

    return { message: "Payment completed successfully" };
};

const dispatchStripeEvent = async (event: Stripe.Event) => {
    switch (event.type) {
        case "checkout.session.completed": {
            const session = event.data.object as Stripe.Checkout.Session;
            return handleCheckoutCompleted(event, session);
        }
        case "checkout.session.expired":
        case "checkout.session.async_payment_failed": {
            const session = event.data.object as Stripe.Checkout.Session;
            await markPaymentFailed(event, session);
            return { message: `Handled ${event.type}` };
        }
        default:
            return { message: `Unhandled event type: ${event.type}` };
    }
};

const handleStripeWebhookEvent = async (event: Stripe.Event) => {
    const claimed = await claimWebhookEvent(STRIPE_PROVIDER, event.id, event.type);

    if (!claimed) {
        return { message: "Event already processed" };
    }

    try {
        const result = await dispatchStripeEvent(event);
        await markWebhookEventProcessed(STRIPE_PROVIDER, event.id);
        return result;
    } catch (error) {
        await markWebhookEventFailed(STRIPE_PROVIDER, event.id, error);
        throw error;
    }
};

export const PaymentService = {
    handleStripeWebhookEvent,
};
