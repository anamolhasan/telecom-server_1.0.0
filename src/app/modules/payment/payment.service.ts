import status from "http-status";
import Stripe from "stripe";
import { Prisma } from "../../../generated/prisma/client";
import {
    OrderStatus,
    PaymentStatus,
} from "../../../generated/prisma/enums";
import AppError from "../../errorHelpers/AppError";
import { prisma } from "../../lib/prisma";
import { CommissionService } from "../commission/commission.service";


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

const handleStripeWebhookEvent = async (event: Stripe.Event) => {
    const processedEvent = await prisma.payment.findFirst({
        where: { stripeEventId: event.id },
    });

    if (processedEvent) {
        return { message: "Event already processed" };
    }

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

export const PaymentService = {
    handleStripeWebhookEvent,
};
