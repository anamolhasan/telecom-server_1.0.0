import status from "http-status";
import { v7 as uuidv7 } from "uuid";
import { Order } from "../../../generated/prisma/client";
import { OrderStatus, PaymentStatus } from "../../../generated/prisma/enums";
import AppError from "../../errorHelpers/AppError";
import { envVars } from "../../config/env";
import { stripe } from "../../config/stripe.config";
import { DEFAULT_CURRENCY } from "../../constants/telecom.constant";
import { IQueryParams, PrismaModelDelegate } from "../../interfaces/query.interface";
import { IRequestUser } from "../../interfaces/requestUser.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { ICreateOrderPayload } from "./order.interface";


const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
    [OrderStatus.PENDING]: [OrderStatus.PAID, OrderStatus.CANCELLED, OrderStatus.FAILED],
    [OrderStatus.PAID]: [OrderStatus.PROCESSING, OrderStatus.CANCELLED, OrderStatus.FAILED],
    [OrderStatus.PROCESSING]: [OrderStatus.COMPLETED, OrderStatus.FAILED],
    [OrderStatus.COMPLETED]: [],
    [OrderStatus.CANCELLED]: [],
    [OrderStatus.FAILED]: [],
};

const createOrder = async (payload: ICreateOrderPayload, user: IRequestUser) => {
    const product = await prisma.product.findFirst({
        where: { id: payload.productId, isDeleted: false, isActive: true },
    });

    if (!product) {
        throw new AppError(status.NOT_FOUND, "Product not found or not available");
    }

    const quantity = payload.quantity ?? 1;
    const unitPrice = product.price;
    const totalAmount = unitPrice * quantity;
    const commissionAmount = (totalAmount * product.commissionRate) / 100;

    return prisma.order.create({
        data: {
            userId: user.userId,
            productId: product.id,
            quantity,
            unitPrice,
            totalAmount,
            commissionAmount,
            targetNumber: payload.targetNumber,
            note: payload.note,
            status: OrderStatus.PENDING,
            paymentStatus: PaymentStatus.PENDING,
        },
    });
};

const initiatePayment = async (orderId: string, user: IRequestUser) => {
    const order = await prisma.order.findFirst({
        where: { id: orderId, userId: user.userId },
        include: { product: { include: { operator: true } }, payment: true },
    });

    if (!order) {
        throw new AppError(status.NOT_FOUND, "Order not found");
    }

    if (order.paymentStatus === PaymentStatus.PAID) {
        throw new AppError(status.BAD_REQUEST, "Order is already paid");
    }

    if (order.status === OrderStatus.CANCELLED || order.status === OrderStatus.FAILED) {
        throw new AppError(status.BAD_REQUEST, `Order is ${order.status.toLowerCase()} and cannot be paid`);
    }

    let payment = order.payment;

    if (!payment) {
        payment = await prisma.payment.create({
            data: {
                orderId: order.id,
                userId: user.userId,
                amount: order.totalAmount,
                currency: DEFAULT_CURRENCY,
                transactionId: uuidv7(),
                status: PaymentStatus.PENDING,
            },
        });
    }

    const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [
            {
                price_data: {
                    currency: DEFAULT_CURRENCY,
                    product_data: {
                        name: `${order.product.operator.name} - ${order.product.name}`,
                    },
                    unit_amount: Math.round(order.unitPrice * 100),
                },
                quantity: order.quantity,
            },
        ],
        metadata: {
            orderId: order.id,
            paymentId: payment.id,
        },
        success_url: `${envVars.FRONTEND_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${envVars.FRONTEND_URL}/payment/cancel?order_id=${order.id}`,
    });

    await prisma.payment.update({
        where: { id: payment.id },
        data: { stripeSessionId: session.id },
    });

    return {
        orderId: order.id,
        paymentId: payment.id,
        paymentUrl: session.url,
    };
};

const getMyOrders = async (user: IRequestUser, query: IQueryParams) => {
    const queryBuilder = new QueryBuilder<Order>(
        prisma.order as unknown as PrismaModelDelegate,
        query,
        {
            searchableFields: ["targetNumber"],
            filterableFields: ["status", "paymentStatus", "productId"],
        },
    );

    return queryBuilder
        .filter()
        .where({ userId: user.userId })
        .include({ product: { include: { operator: true } } })
        .sort()
        .paginate()
        .fields()
        .execute();
};

const getMyOrder = async (orderId: string, user: IRequestUser) => {
    const order = await prisma.order.findFirst({
        where: { id: orderId, userId: user.userId },
        include: { product: { include: { operator: true } }, payment: true },
    });

    if (!order) {
        throw new AppError(status.NOT_FOUND, "Order not found");
    }

    return order;
};

const getAllOrders = async (query: IQueryParams) => {
    const queryBuilder = new QueryBuilder<Order>(
        prisma.order as unknown as PrismaModelDelegate,
        query,
        {
            searchableFields: ["id", "targetNumber", "user.name", "user.email"],
            filterableFields: ["status", "paymentStatus", "userId", "productId"],
        },
    );

    return queryBuilder
        .search()
        .filter()
        .include({ product: { include: { operator: true } }, payment: true })
        .sort()
        .paginate()
        .fields()
        .execute();
};

const changeOrderStatus = async (orderId: string, nextStatus: OrderStatus) => {
    const order = await prisma.order.findUnique({ where: { id: orderId } });

    if (!order) {
        throw new AppError(status.NOT_FOUND, "Order not found");
    }

    const allowed = ORDER_STATUS_TRANSITIONS[order.status];

    if (!allowed.includes(nextStatus)) {
        throw new AppError(
            status.BAD_REQUEST,
            `Cannot change order status from ${order.status} to ${nextStatus}`,
        );
    }

    return prisma.order.update({
        where: { id: orderId },
        data: {
            status: nextStatus,
            ...(nextStatus === OrderStatus.PAID ? { paymentStatus: PaymentStatus.PAID } : {}),
        },
    });
};

export const OrderService = {
    createOrder,
    initiatePayment,
    getMyOrders,
    getMyOrder,
    getAllOrders,
    changeOrderStatus,
};
