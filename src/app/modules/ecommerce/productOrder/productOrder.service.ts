import { randomInt } from "node:crypto";
import status from "http-status";
import type { Prisma, ProductOrder } from "../../../../generated/prisma/client";
import {
    ProductOrderStatus,
    ProductPaymentMethod,
    ProductPaymentStatus,
    ProductStatus,
} from "../../../../generated/prisma/enums";
import AppError from "../../../errorHelpers/AppError";
import type {
    IQueryParams,
    PrismaModelDelegate,
} from "../../../interfaces/query.interface";
import type { IRequestUser } from "../../../interfaces/requestUser.interface";
import { prisma } from "../../../lib/prisma";
import { QueryBuilder } from "../../../utils/QueryBuilder";
import { AffiliateConversionService } from "../../earningPrograms/affiliate/affiliate/affiliate.conversion";
import { EarningService } from "../../earning/earning.service";
import { toMoneyCents } from "../ecommerce.utils";
import type {
    ICheckoutPayload,
    IShippingAddressSnapshot,
} from "./productOrder.interface";
import {
    toAdminProductOrder,
    toAdminProductOrders,
    toPublicProductOrder,
    toPublicProductOrders,
    type IAdminProductOrderView,
    type IProductOrderView,
    type ProductOrderWithItems,
} from "./productOrder.public";
import { MAX_ORDER_LINE_QUANTITY } from "./productOrder.validation";

// ─────────────────────────────────────────────────────────────────────────────
// Order numbers
// ─────────────────────────────────────────────────────────────────────────────
// Human-readable and support-friendly (RZQ-20261018-004213): a date part plus a
// six-digit random suffix. Randomness (not a counter) means no sequence table and
// no per-day row lock; the unique index on `orderNumber` is the real guarantee,
// and `checkout` retries with a fresh number if a collision ever occurs.
const ORDER_NUMBER_PREFIX = "RZQ";
const ORDER_NUMBER_RANGE = 1_000_000;
const MAX_ORDER_NUMBER_ATTEMPTS = 5;

const buildOrderNumber = (): string => {
    const now = new Date();
    const datePart = [
        now.getUTCFullYear(),
        String(now.getUTCMonth() + 1).padStart(2, "0"),
        String(now.getUTCDate()).padStart(2, "0"),
    ].join("");

    const randomPart = String(randomInt(ORDER_NUMBER_RANGE)).padStart(6, "0");

    return `${ORDER_NUMBER_PREFIX}-${datePart}-${randomPart}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// Fulfilment lifecycle
// ─────────────────────────────────────────────────────────────────────────────
// Forward-only fulfilment flow, kept strictly separate from payment collection
// (see updateOrderPayment): reaching DELIVERED never marks an order PAID.
//
// Cancellation is deliberately NOT reachable. No business rule yet says who may
// cancel an order or how the stock deducted at checkout would be returned, and
// cancelling without restoring stock would silently lose inventory — so the
// transition is refused instead of guessed at (reported as not implemented).
const ORDER_STATUS_TRANSITIONS: Record<
    ProductOrderStatus,
    ProductOrderStatus[]
> = {
    [ProductOrderStatus.PENDING]: [ProductOrderStatus.CONFIRMED],
    [ProductOrderStatus.CONFIRMED]: [ProductOrderStatus.PROCESSING],
    [ProductOrderStatus.PROCESSING]: [ProductOrderStatus.SHIPPED],
    [ProductOrderStatus.SHIPPED]: [ProductOrderStatus.DELIVERED],
    [ProductOrderStatus.DELIVERED]: [],
    [ProductOrderStatus.CANCELLED]: [],
};

// ─────────────────────────────────────────────────────────────────────────────
// Money
// ─────────────────────────────────────────────────────────────────────────────
// Every amount is computed in integer paisa and written back as a fixed
// 2-decimal string, so no binary floating point rounding can ever reach a
// Decimal(12, 2) column ("30.50", never 30.499999999999996).
const toDecimalString = (cents: number): string => (cents / 100).toFixed(2);

// No delivery-fee or coupon/promotion rules exist in this phase, so both are
// fixed at zero and are computed server-side like every other total. When those
// rules arrive they belong here, not in the client payload.
const SHIPPING_AMOUNT_CENTS = 0;
const DISCOUNT_AMOUNT_CENTS = 0;

const isUniqueConstraintError = (error: unknown): boolean =>
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "P2002";

// ─────────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────────
const orderInclude = {
    items: { orderBy: { createdAt: "asc" } },
} satisfies Prisma.ProductOrderInclude;

const idempotencyWhere = (userId: string, idempotencyKey: string) => ({
    uniq_product_order_user_idempotency_key: { userId, idempotencyKey },
});

interface ICheckoutLine {
    cartItemId: string;
    variantId: string;
    productId: string;
    productName: string;
    variantName: string | null;
    sku: string;
    quantity: number;
    unitPriceCents: number;
    lineTotalCents: number;
}

// Structural shape of the cart rows loaded for checkout. Prices come from the
// variant row only; a client never supplies one.
interface ICheckoutCartItem {
    id: string;
    variantId: string;
    quantity: number;
    variant: {
        id: string;
        sku: string;
        name: string | null;
        price: unknown;
        isActive: boolean;
        isDeleted: boolean;
        product: {
            id: string;
            name: string;
            status: ProductStatus;
            isActive: boolean;
            isDeleted: boolean;
        };
    };
}

interface ICheckoutResult {
    order: ProductOrderWithItems;
    // True when this call returned an order placed by an earlier attempt rather
    // than creating one (a replay), so the controller can answer 200 instead of 201.
    idempotent: boolean;
}

// What the API returns. The raw row is mapped through the public projection so
// `userId` and the internal `idempotencyKey` never leave the server.
interface ICheckoutResponse {
    order: IProductOrderView;
    idempotent: boolean;
}

const toCheckoutResponse = (result: ICheckoutResult): ICheckoutResponse => ({
    order: toPublicProductOrder(result.order),
    idempotent: result.idempotent,
});

// Turns one cart line into an order line, refusing anything that is no longer
// sellable. Everything a client could tamper with (price, SKU, product name) is
// taken from the database row.
const buildCheckoutLine = (item: ICheckoutCartItem): ICheckoutLine => {
    const { variant } = item;

    // Cart quantities are application-validated, not DB-constrained, so re-check
    // the range before it can reach an order line.
    if (item.quantity < 1 || item.quantity > MAX_ORDER_LINE_QUANTITY) {
        throw new AppError(
            status.BAD_REQUEST,
            `Invalid quantity for ${variant.sku}`,
        );
    }

    // A variant can be deactivated, archived or soft-deleted while it sits in a
    // cart, so availability is re-checked here and not only when it was added.
    if (
        !variant.isActive ||
        variant.isDeleted ||
        variant.product.isDeleted ||
        !variant.product.isActive ||
        variant.product.status !== ProductStatus.ACTIVE
    ) {
        throw new AppError(
            status.BAD_REQUEST,
            `Product variant ${variant.sku} is no longer available`,
        );
    }

    const unitPriceCents = toMoneyCents(variant.price);

    if (unitPriceCents < 0) {
        throw new AppError(status.BAD_REQUEST, `Invalid price for ${variant.sku}`);
    }

    return {
        cartItemId: item.id,
        variantId: variant.id,
        productId: variant.product.id,
        productName: variant.product.name,
        variantName: variant.name ?? null,
        sku: variant.sku,
        quantity: item.quantity,
        unitPriceCents,
        lineTotalCents: unitPriceCents * item.quantity,
    };
};

// The delivery target is either the caller's own saved address or a validated
// inline snapshot. Either way it is copied onto the order, so later edits to the
// address book cannot rewrite history.
const resolveShippingSnapshot = async (
    tx: Prisma.TransactionClient,
    userId: string,
    payload: ICheckoutPayload,
): Promise<IShippingAddressSnapshot> => {
    if (payload.shippingAddress) {
        return payload.shippingAddress;
    }

    if (!payload.addressId) {
        throw new AppError(
            status.BAD_REQUEST,
            "A delivery address is required to place an order",
        );
    }

    // Scoped to the caller's own address book, so another user's address id is
    // indistinguishable from one that does not exist.
    const address = await tx.shippingAddress.findFirst({
        where: { id: payload.addressId, userId, isDeleted: false },
    });

    if (!address) {
        throw new AppError(status.NOT_FOUND, "Shipping address not found");
    }

    return {
        recipientName: address.recipientName,
        phone: address.phone,
        division: address.division,
        district: address.district,
        upazila: address.upazila ?? undefined,
        unionArea: address.unionArea ?? undefined,
        villageRoad: address.villageRoad ?? undefined,
        postalCode: address.postalCode ?? undefined,
    };
};

const findByCheckoutIdempotencyKey = async (
    userId: string,
    idempotencyKey: string,
): Promise<ProductOrderWithItems | null> => {
    const order = await prisma.productOrder.findUnique({
        where: idempotencyWhere(userId, idempotencyKey),
        include: orderInclude,
    });

    return order as ProductOrderWithItems | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Checkout
// ─────────────────────────────────────────────────────────────────────────────
// One transaction: the order, its items, the stock decrements and the cart
// cleanup either all happen or none of them do. Nothing client-supplied can
// reach a persisted price, total, stock value or status.
const runCheckout = async (
    user: IRequestUser,
    payload: ICheckoutPayload,
    idempotencyKey: string,
    orderNumber: string,
): Promise<ICheckoutResult> =>
    prisma.$transaction(async (tx) => {
        // Replay check inside the transaction too: two simultaneous attempts both
        // miss the fast path, and the unique (userId, idempotencyKey) index then
        // rejects the loser, which the caller turns into "return the winner".
        const replay = await tx.productOrder.findUnique({
            where: idempotencyWhere(user.userId, idempotencyKey),
            include: orderInclude,
        });

        if (replay) {
            return {
                order: replay as ProductOrderWithItems,
                idempotent: true,
            };
        }

        // The cart is read inside the transaction with the authenticated user id,
        // never from a client-supplied identifier.
        const cart = await tx.cart.findUnique({
            where: { userId: user.userId },
            include: {
                items: {
                    include: {
                        variant: {
                            include: {
                                product: {
                                    select: {
                                        id: true,
                                        name: true,
                                        status: true,
                                        isActive: true,
                                        isDeleted: true,
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });

        if (!cart || cart.items.length === 0) {
            throw new AppError(status.BAD_REQUEST, "Your cart is empty");
        }

        const shippingAddress = await resolveShippingSnapshot(
            tx,
            user.userId,
            payload,
        );

        const lines = (cart.items as unknown as ICheckoutCartItem[]).map(
            buildCheckoutLine,
        );

        const subtotalCents = lines.reduce(
            (sum, line) => sum + line.lineTotalCents,
            0,
        );
        const grandTotalCents =
            subtotalCents - DISCOUNT_AMOUNT_CENTS + SHIPPING_AMOUNT_CENTS;

        // A deterministic order means concurrent checkouts touch the same
        // variants in the same sequence, which prevents PostgreSQL deadlocks.
        const orderedLines = [...lines].sort((left, right) =>
            left.variantId.localeCompare(right.variantId),
        );

        for (const line of orderedLines) {
            // Conditional atomic decrement: the "is there enough stock?" guard and
            // the write are a single statement, so two concurrent checkouts can
            // never both pass it and oversell. No read-then-write, and the column
            // can never go negative.
            const decremented = await tx.inventory.updateMany({
                where: {
                    variantId: line.variantId,
                    availableQuantity: { gte: line.quantity },
                },
                data: { availableQuantity: { decrement: line.quantity } },
            });

            if (decremented.count === 0) {
                // Throwing aborts the transaction, which also rolls back every
                // decrement already applied to the earlier lines.
                throw new AppError(
                    status.CONFLICT,
                    `Insufficient stock for ${line.sku}`,
                );
            }
        }

        const order = await tx.productOrder.create({
            data: {
                orderNumber,
                userId: user.userId,
                status: ProductOrderStatus.PENDING,
                paymentMethod: payload.paymentMethod ?? ProductPaymentMethod.COD,
                // Cash on Delivery: the money is collected on delivery, so an
                // order is never created as PAID.
                paymentStatus: ProductPaymentStatus.UNPAID,
                paidAt: null,
                idempotencyKey,
                subtotal: toDecimalString(subtotalCents),
                discountAmount: toDecimalString(DISCOUNT_AMOUNT_CENTS),
                shippingAmount: toDecimalString(SHIPPING_AMOUNT_CENTS),
                grandTotal: toDecimalString(grandTotalCents),
                shippingRecipientName: shippingAddress.recipientName,
                shippingPhone: shippingAddress.phone,
                shippingDivision: shippingAddress.division,
                shippingDistrict: shippingAddress.district,
                shippingUpazila: shippingAddress.upazila ?? null,
                shippingUnionArea: shippingAddress.unionArea ?? null,
                shippingVillageRoad: shippingAddress.villageRoad ?? null,
                shippingPostalCode: shippingAddress.postalCode ?? null,
                customerNote: payload.customerNote ?? null,
                items: {
                    create: lines.map((line) => ({
                        variantId: line.variantId,
                        productId: line.productId,
                        // Purchase-time snapshots: renaming, repricing or deleting
                        // the catalog row later must not alter this order.
                        productName: line.productName,
                        variantName: line.variantName,
                        sku: line.sku,
                        unitPrice: toDecimalString(line.unitPriceCents),
                        quantity: line.quantity,
                        lineTotal: toDecimalString(line.lineTotalCents),
                    })),
                },
            },
            include: orderInclude,
        });

        // The cart is emptied only after the order exists and stock is deducted.
        // Scoped to the exact rows that were purchased, so a line added
        // concurrently stays in the cart.
        await tx.cartItem.deleteMany({
            where: {
                cartId: cart.id,
                id: { in: lines.map((line) => line.cartItemId) },
            },
        });

        return { order: order as ProductOrderWithItems, idempotent: false };
    });

// Places a COD order from the caller's own cart.
//
// Idempotency: the client sends one key per checkout attempt and
// (userId, idempotencyKey) is unique in the database, so a double-click, retry
// or network timeout resolves to the original order instead of ordering (and
// deducting stock) twice. Client-side button disabling is deliberately not
// relied upon.
const checkout = async (
    user: IRequestUser,
    payload: ICheckoutPayload,
): Promise<ICheckoutResponse> => {
    const idempotencyKey = payload.idempotencyKey.trim();

    // Fast path for the common retry: return the order placed by the first
    // attempt without touching the cart or stock again.
    const replay = await findByCheckoutIdempotencyKey(user.userId, idempotencyKey);

    if (replay) {
        return toCheckoutResponse({ order: replay, idempotent: true });
    }

    for (let attempt = 0; attempt < MAX_ORDER_NUMBER_ATTEMPTS; attempt += 1) {
        try {
            const placed = await runCheckout(
                user,
                payload,
                idempotencyKey,
                buildOrderNumber(),
            );

            return toCheckoutResponse(placed);
        } catch (error) {
            if (!isUniqueConstraintError(error)) {
                throw error;
            }

            // A concurrent request with the same idempotency key won the race.
            // Return its order rather than failing the client.
            const concurrent = await findByCheckoutIdempotencyKey(
                user.userId,
                idempotencyKey,
            );

            if (concurrent) {
                return toCheckoutResponse({
                    order: concurrent,
                    idempotent: true,
                });
            }

            // Otherwise the random order number collided. The transaction rolled
            // back completely, so retrying with a fresh number is safe.
        }
    }

    throw new AppError(
        status.INTERNAL_SERVER_ERROR,
        "Could not allocate a unique order number. Please try again.",
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────
const getMyOrders = async (user: IRequestUser, query: IQueryParams) => {
    const result = await new QueryBuilder<ProductOrder>(
        prisma.productOrder as unknown as PrismaModelDelegate,
        query,
        {
            searchableFields: ["orderNumber"],
            filterableFields: ["status", "paymentStatus"],
        },
    )
        .search()
        .filter()
        // Ownership is forced *after* the client filters, so a query string can
        // never widen the projection to another user's orders.
        .where({ userId: user.userId })
        .include({ ...orderInclude })
        .sort()
        .paginate()
        .fields()
        .execute();

    return {
        ...result,
        data: toPublicProductOrders(
            result.data as unknown as ProductOrderWithItems[],
        ),
    };
};

const getMyOrder = async (
    user: IRequestUser,
    orderId: string,
): Promise<IProductOrderView> => {
    // Ownership is part of the WHERE: another user's order is reported as
    // missing, never as forbidden, so an id cannot be probed for existence.
    const order = await prisma.productOrder.findFirst({
        where: { id: orderId, userId: user.userId },
        include: orderInclude,
    });

    if (!order) {
        throw new AppError(status.NOT_FOUND, "Order not found");
    }

    return toPublicProductOrder(order as ProductOrderWithItems);
};

const getAllProductOrders = async (query: IQueryParams) => {
    const result = await new QueryBuilder<ProductOrder>(
        prisma.productOrder as unknown as PrismaModelDelegate,
        query,
        {
            searchableFields: ["orderNumber", "user.name", "user.email"],
            filterableFields: ["status", "paymentStatus", "userId"],
        },
    )
        .search()
        .filter()
        .include({ ...orderInclude })
        .sort()
        .paginate()
        .fields()
        .execute();

    return {
        ...result,
        data: toAdminProductOrders(
            result.data as unknown as ProductOrderWithItems[],
        ),
    };
};

const getProductOrderById = async (
    orderId: string,
): Promise<IAdminProductOrderView> => {
    const order = await prisma.productOrder.findUnique({
        where: { id: orderId },
        include: orderInclude,
    });

    if (!order) {
        throw new AppError(status.NOT_FOUND, "Order not found");
    }

    return toAdminProductOrder(order as ProductOrderWithItems);
};

// ─────────────────────────────────────────────────────────────────────────────
// Staff updates
// ─────────────────────────────────────────────────────────────────────────────
const updateOrderStatus = async (
    orderId: string,
    nextStatus: ProductOrderStatus,
): Promise<IAdminProductOrderView> => {
    const order = await prisma.productOrder.findUnique({
        where: { id: orderId },
        select: { id: true, status: true },
    });

    if (!order) {
        throw new AppError(status.NOT_FOUND, "Order not found");
    }

    if (!ORDER_STATUS_TRANSITIONS[order.status].includes(nextStatus)) {
        throw new AppError(
            status.BAD_REQUEST,
            `Cannot change order status from ${order.status} to ${nextStatus}`,
        );
    }

    // The current status is part of the WHERE, so two concurrent transitions
    // cannot both succeed and skip a step. Affiliate commission is settled in the
    // SAME transaction as the transition, so money can never be credited for a
    // state change that rolled back, and a genuine delivery can never lose its
    // commission. The settlement is a no-op for an unattributed order.
    await prisma.$transaction(async (tx) => {
        const result = await tx.productOrder.updateMany({
            where: { id: orderId, status: order.status },
            data: { status: nextStatus },
        });

        if (result.count === 0) {
            throw new AppError(
                status.CONFLICT,
                "Order status changed concurrently. Please reload and try again.",
            );
        }

        if (nextStatus === ProductOrderStatus.CANCELLED) {
            // A cancelled order must never keep program money: the shared ledger
            // appends a compensating reversal for every earning of this order and
            // the affiliate conversions are frozen. (Cancellation is not reachable
            // through the transition map yet — this keeps the money correct the
            // moment a cancellation rule is defined.)
            await EarningService.reverseEarningsForSource(tx, {
                productOrderId: orderId,
            });
            await AffiliateConversionService.revokeConversionsForProductOrder(
                tx,
                orderId,
            );
        } else {
            await AffiliateConversionService.recordConversionsForProductOrder(
                tx,
                orderId,
            );
        }

        return result;
    });

    const reloaded = await prisma.productOrder.findUniqueOrThrow({
        where: { id: orderId },
        include: orderInclude,
    });

    return toAdminProductOrder(reloaded as ProductOrderWithItems);
};

// Records cash collected for a COD order. Payment collection is intentionally a
// separate operation from fulfilment: an order can be DELIVERED and still UNPAID
// until the courier remits the cash.
const updateOrderPayment = async (
    orderId: string,
    nextStatus: ProductPaymentStatus,
): Promise<IAdminProductOrderView> => {
    const order = await prisma.productOrder.findUnique({
        where: { id: orderId },
        select: { id: true, paymentStatus: true },
    });

    if (!order) {
        throw new AppError(status.NOT_FOUND, "Order not found");
    }

    if (order.paymentStatus === nextStatus) {
        throw new AppError(
            status.BAD_REQUEST,
            `Order payment is already ${nextStatus}`,
        );
    }

    // COD money moves forward only: UNPAID -> PAID. Re-opening a paid order or
    // refunding it needs a business rule (and a refund workflow) that this phase
    // does not have, so it is refused rather than guessed at.
    if (
        order.paymentStatus !== ProductPaymentStatus.UNPAID ||
        nextStatus !== ProductPaymentStatus.PAID
    ) {
        throw new AppError(
            status.BAD_REQUEST,
            `Cannot change payment status from ${order.paymentStatus} to ${nextStatus}`,
        );
    }

    // Money collection and affiliate settlement share one transaction: a COD order
    // that becomes PAID while already DELIVERED confirms its conversions at the
    // same moment, so the settlement can never be skipped or half-applied.
    await prisma.$transaction(async (tx) => {
        const result = await tx.productOrder.updateMany({
            where: { id: orderId, paymentStatus: ProductPaymentStatus.UNPAID },
            data: {
                paymentStatus: ProductPaymentStatus.PAID,
                paidAt: new Date(),
            },
        });

        if (result.count === 0) {
            throw new AppError(
                status.CONFLICT,
                "Payment status changed concurrently. Please reload and try again.",
            );
        }

        await AffiliateConversionService.recordConversionsForProductOrder(tx, orderId);

        return result;
    });

    const reloaded = await prisma.productOrder.findUniqueOrThrow({
        where: { id: orderId },
        include: orderInclude,
    });

    return toAdminProductOrder(reloaded as ProductOrderWithItems);
};

export const ProductOrderService = {
    checkout,
    getMyOrders,
    getMyOrder,
    getAllProductOrders,
    getProductOrderById,
    updateOrderStatus,
    updateOrderPayment,
};
