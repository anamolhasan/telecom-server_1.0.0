import status from "http-status";
import { v5 as uuidv5, v7 as uuidv7 } from "uuid";
import { Order, Prisma } from "../../../../generated/prisma/client";
import {
    OrderStatus,
    PaymentStatus,
    WalletTransactionReason,
    WalletTransactionType,
} from "../../../../generated/prisma/enums";
import AppError from "../../../errorHelpers/AppError";
import { envVars } from "../../../config/env";
import { stripe } from "../../../config/stripe.config";
import { DEFAULT_CURRENCY } from "../../../constants/telecom.constant";
import { IQueryParams, PrismaModelDelegate } from "../../../interfaces/query.interface";
import { IRequestUser } from "../../../interfaces/requestUser.interface";
import { prisma } from "../../../lib/prisma";
import { QueryBuilder } from "../../../utils/QueryBuilder";
import { CommissionService } from "../../commission/commission.service";
import { ReferralService } from "../../earningPrograms/referral/referral.service";
import { applyWalletTransaction } from "../../wallet/wallet.utils";
import { ICreateOrderPayload, ICreateOrderWithWalletPayload } from "./order.interface";

// Stable namespace used to derive a deterministic order id from a client
// idempotency key so retried wallet purchases resolve to the same order.
const ORDER_IDEMPOTENCY_NAMESPACE = "5f9c1f7e-4a3b-4c2d-9e1f-7b6a5c4d3e2f";

const isUniqueConstraintError = (error: unknown): boolean =>
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "P2002";


const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
    [OrderStatus.PENDING]: [OrderStatus.PROCESSING, OrderStatus.CANCELLED, OrderStatus.FAILED],
    [OrderStatus.PROCESSING]: [OrderStatus.WORKING, OrderStatus.CANCELLED, OrderStatus.FAILED],
    [OrderStatus.WORKING]: [OrderStatus.COMPLETED, OrderStatus.FAILED],
    [OrderStatus.COMPLETED]: [],
    [OrderStatus.CANCELLED]: [],
    [OrderStatus.FAILED]: [],
};

const createOrder = async (payload: ICreateOrderPayload, user: IRequestUser) => {
    const operatorOffer = await prisma.operatorOffer.findFirst({
        where: { id: payload.operatorOfferId, isDeleted: false, isActive: true },
    });

    if (!operatorOffer) {
        throw new AppError(status.NOT_FOUND, "Offer not found or not available");
    }

    // The buyer defaults to the acting user (personal purchase). A distinct buyer
    // makes the acting user the seller, which requires agent (canEarn) rights.
    const buyerId = payload.buyerId?.trim() || user.userId;
    let sellerId: string | null = null;

    if (buyerId !== user.userId) {
        const seller = await prisma.appUser.findUnique({
            where: { authUserId: user.userId },
            select: { canEarn: true },
        });

        if (!seller?.canEarn) {
            throw new AppError(
                status.FORBIDDEN,
                "Only authorized agents can sell offers to other users",
            );
        }

        const buyer = await prisma.user.findFirst({
            where: { id: buyerId, isDeleted: false },
            select: { id: true },
        });

        if (!buyer) {
            throw new AppError(status.NOT_FOUND, "Buyer not found");
        }

        sellerId = user.userId;
    }

    const quantity = payload.quantity ?? 1;
    const unitPrice = operatorOffer.price;
    const totalAmount = unitPrice * quantity;
    // Commission amounts are always derived server-side from the offer rates.
    const commissionAmount = (totalAmount * operatorOffer.commissionRate) / 100;
    const referralCommissionAmount = (totalAmount * operatorOffer.referralCommissionRate) / 100;

    return prisma.order.create({
        data: {
            userId: buyerId,
            sellerId,
            operatorOfferId: operatorOffer.id,
            quantity,
            unitPrice,
            totalAmount,
            commissionAmount,
            referralCommissionAmount,
            targetNumber: payload.targetNumber,
            note: payload.note,
            status: OrderStatus.PENDING,
            paymentStatus: PaymentStatus.PENDING,
        },
    });
};

const initiatePayment = async (orderId: string, user: IRequestUser) => {
    const order = await prisma.order.findFirst({
        where: {
            id: orderId,
            OR: [{ userId: user.userId }, { sellerId: user.userId }],
        },
        include: { operatorOffer: { include: { operator: true } }, payment: true },
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
                userId: order.userId,
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
                        name: `${order.operatorOffer.operator.name} - ${order.operatorOffer.name}`,
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

interface IWalletSettleOrder {
    id: string;
    userId: string;
    quantity: number;
    totalAmount: number;
    operatorOfferId: string;
}

interface IWalletSettleOffer {
    price: number;
    isActive: boolean;
    isDeleted: boolean;
}

// Shared wallet-settlement core used by both the "pay an existing order" and
// "create + pay" flows. Re-validates the offer price server-side, atomically
// claims the order (so it can never be charged twice), records the balance
// debit with its ledger entry, and marks the order PAID. It deliberately never
// sets COMPLETED: fulfilment is a separate, staff-driven step.
const settleOrderFromWallet = async (
    tx: Prisma.TransactionClient,
    order: IWalletSettleOrder,
    offer: IWalletSettleOffer | null | undefined,
    user: IRequestUser,
) => {
    // Only the buyer who owns (and pays for) the order may spend their wallet.
    if (order.userId !== user.userId) {
        throw new AppError(status.FORBIDDEN, "You can only pay for your own orders");
    }

    // The offer must still be purchasable at the time of payment.
    if (!offer || offer.isDeleted || !offer.isActive) {
        throw new AppError(status.NOT_FOUND, "Offer not found or not available");
    }

    // Re-derive the amount server-side from the current offer; never trust a
    // client-supplied total. If the offer price moved, the order is stale.
    const serverTotal = offer.price * order.quantity;

    if (Math.abs(serverTotal - order.totalAmount) > 0.0001) {
        throw new AppError(
            status.CONFLICT,
            "Offer price has changed; please create a new order",
        );
    }

    // Atomically claim the order so duplicate/concurrent attempts cannot debit
    // the wallet more than once. This rolls back with the transaction if the
    // debit below fails (e.g. insufficient balance).
    const claim = await tx.order.updateMany({
        where: {
            id: order.id,
            userId: user.userId,
            paymentStatus: { not: PaymentStatus.PAID },
            status: { notIn: [OrderStatus.CANCELLED, OrderStatus.FAILED] },
        },
        data: {
            paymentStatus: PaymentStatus.PAID,
            status: OrderStatus.PROCESSING,
        },
    });

    if (claim.count === 0) {
        throw new AppError(status.CONFLICT, "Order is already paid");
    }

    // Atomic debit + ledger entry; throws on insufficient balance. The ledger
    // row is the verified server-side payment confirmation for this order.
    const walletTransaction = await applyWalletTransaction(tx, {
        userId: order.userId,
        amount: serverTotal,
        type: WalletTransactionType.DEBIT,
        reason: WalletTransactionReason.ORDER_PAYMENT,
        description: `Wallet payment for order ${order.id}`,
        orderId: order.id,
    });

    const updated = await tx.order.findUniqueOrThrow({
        where: { id: order.id },
    });

    return { order: updated, walletTransaction, idempotent: false as const };
};

// Pays an existing PENDING order from the buyer's wallet. Everything (order
// state change, balance decrement and ledger entry) happens in one database
// transaction so a failed debit never leaves a paid order behind.
const payOrderWithWallet = async (orderId: string, user: IRequestUser) => {
    return prisma.$transaction(async (tx) => {
        const order = await tx.order.findUnique({
            where: { id: orderId },
            include: { operatorOffer: true },
        });

        if (!order) {
            throw new AppError(status.NOT_FOUND, "Order not found");
        }

        return settleOrderFromWallet(tx, order, order.operatorOffer, user);
    });
};

// Creates an operator-offer order and pays for it from the acting user's wallet
// atomically. Either the order exists and is PAID with a matching ledger entry,
// or nothing is persisted. An optional idempotency key makes safe retries
// resolve to the original order instead of creating a duplicate.
const createOrderWithWallet = async (
    payload: ICreateOrderWithWalletPayload,
    user: IRequestUser,
) => {
    // Wallet purchases are always personal: the authenticated user is the buyer
    // and the only account that can be debited.
    if (payload.buyerId && payload.buyerId !== user.userId) {
        throw new AppError(
            status.BAD_REQUEST,
            "Wallet purchases cannot be made on behalf of another user",
        );
    }

    const idempotencyKey = payload.idempotencyKey?.trim();
    const orderId = idempotencyKey
        ? uuidv5(`${user.userId}:${idempotencyKey}`, ORDER_IDEMPOTENCY_NAMESPACE)
        : undefined;

    try {
        return await prisma.$transaction(async (tx) => {
            // Replay of a retried request: hand back the original order and the
            // original ledger entry without touching the wallet again.
            if (orderId) {
                const existing = await tx.order.findUnique({
                    where: { id: orderId },
                    include: { operatorOffer: true },
                });

                if (existing) {
                    if (existing.userId !== user.userId) {
                        throw new AppError(status.FORBIDDEN, "Order belongs to another user");
                    }

                    const walletTransaction = await tx.walletTransaction.findFirst({
                        where: {
                            orderId,
                            reason: WalletTransactionReason.ORDER_PAYMENT,
                        },
                    });

                    return { order: existing, walletTransaction, idempotent: true as const };
                }
            }

            const operatorOffer = await tx.operatorOffer.findFirst({
                where: {
                    id: payload.operatorOfferId,
                    isDeleted: false,
                    isActive: true,
                },
            });

            if (!operatorOffer) {
                throw new AppError(status.NOT_FOUND, "Offer not found or not available");
            }

            const quantity = payload.quantity ?? 1;
            const unitPrice = operatorOffer.price;
            const totalAmount = unitPrice * quantity;
            const commissionAmount = (totalAmount * operatorOffer.commissionRate) / 100;
            const referralCommissionAmount =
                (totalAmount * operatorOffer.referralCommissionRate) / 100;

            const order = await tx.order.create({
                data: {
                    ...(orderId ? { id: orderId } : {}),
                    userId: user.userId,
                    sellerId: null,
                    operatorOfferId: operatorOffer.id,
                    quantity,
                    unitPrice,
                    totalAmount,
                    commissionAmount,
                    referralCommissionAmount,
                    targetNumber: payload.targetNumber,
                    note: payload.note,
                    status: OrderStatus.PENDING,
                    paymentStatus: PaymentStatus.PENDING,
                },
            });

            return settleOrderFromWallet(tx, order, operatorOffer, user);
        });
    } catch (error) {
        // Two concurrent retries can both miss the pre-check; the unique order
        // id makes the loser fail here, so we return the winner's order.
        if (orderId && isUniqueConstraintError(error)) {
            const existing = await prisma.order.findUnique({
                where: { id: orderId },
                include: { operatorOffer: true },
            });

            if (existing && existing.userId === user.userId) {
                const walletTransaction = await prisma.walletTransaction.findFirst({
                    where: { orderId, reason: WalletTransactionReason.ORDER_PAYMENT },
                });

                return { order: existing, walletTransaction, idempotent: true as const };
            }
        }

        throw error;
    }
};

const getMyOrders = async (user: IRequestUser, query: IQueryParams) => {
    const queryBuilder = new QueryBuilder<Order>(
        prisma.order as unknown as PrismaModelDelegate,
        query,
        {
            searchableFields: ["targetNumber"],
            filterableFields: ["status", "paymentStatus", "operatorOfferId"],
        },
    );

    return queryBuilder
        .filter()
        .where({ OR: [{ userId: user.userId }, { sellerId: user.userId }] })
        .include({ operatorOffer: { include: { operator: true } } })
        .sort()
        .paginate()
        .fields()
        .execute();
};

const getMyOrder = async (orderId: string, user: IRequestUser) => {
    const order = await prisma.order.findFirst({
        where: {
            id: orderId,
            OR: [{ userId: user.userId }, { sellerId: user.userId }],
        },
        include: { operatorOffer: { include: { operator: true } }, payment: true },
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
            filterableFields: ["status", "paymentStatus", "userId", "operatorOfferId"],
        },
    );

    return queryBuilder
        .search()
        .filter()
        .include({ operatorOffer: { include: { operator: true } }, payment: true })
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

    return prisma.$transaction(async (tx) => {
        const updated = await tx.order.update({
            where: { id: orderId },
            data: {
                status: nextStatus,
                ...(nextStatus === OrderStatus.COMPLETED && order.completedAt === null
                    ? { completedAt: new Date() }
                    : {}),
            },
        });

        if (nextStatus === OrderStatus.COMPLETED) {
            // Commissions are awarded only for a successful (COMPLETED + PAID) order.
            await CommissionService.settleOrderCommissions(tx, orderId);
        } else if (
            nextStatus === OrderStatus.CANCELLED ||
            nextStatus === OrderStatus.FAILED
        ) {
            // Undo any commission if the order never reaches success.
            await CommissionService.revokeOrderCommissions(tx, orderId);
        }

        // Recapture referrer eligibility whenever an order's qualification status changes
        // (completion makes a referred account active; cancellation/failure removes it).
        if (
            nextStatus === OrderStatus.COMPLETED ||
            nextStatus === OrderStatus.CANCELLED ||
            nextStatus === OrderStatus.FAILED
        ) {
            await ReferralService.recalculateReferrerEligibilityForOrder(orderId, tx);
        }

        return updated;
    });
};

export const OrderService = {
    createOrder,
    initiatePayment,
    payOrderWithWallet,
    createOrderWithWallet,
    getMyOrders,
    getMyOrder,
    getAllOrders,
    changeOrderStatus,
};
