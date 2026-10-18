import status from "http-status";
import type { Prisma } from "../../../../generated/prisma/client";
import { ProductStatus } from "../../../../generated/prisma/enums";
import AppError from "../../../errorHelpers/AppError";
import type { IRequestUser } from "../../../interfaces/requestUser.interface";
import { prisma } from "../../../lib/prisma";
import type {
    IAddCartItemPayload,
    IUpdateCartItemPayload,
} from "./cart.interface";
import {
    toCartView,
    type CartWithItems,
    type ICartView,
} from "./cart.public";
import { MAX_CART_ITEM_QUANTITY } from "./cart.validation";

// Stock is read for display only; it is never selected as a writable field, and
// the cart never reserves or decrements it.
const cartInclude = {
    items: {
        orderBy: { createdAt: "asc" },
        include: {
            variant: {
                include: {
                    inventory: { select: { availableQuantity: true } },
                    product: {
                        select: {
                            id: true,
                            name: true,
                            slug: true,
                            status: true,
                            isActive: true,
                            isDeleted: true,
                        },
                    },
                },
            },
        },
    },
} satisfies Prisma.CartInclude;

const getCart = async (user: IRequestUser): Promise<ICartView> => {
    const cart = await prisma.cart.findUnique({
        where: { userId: user.userId },
        include: cartInclude,
    });

    return toCartView(user.userId, cart as CartWithItems | null);
};

// Ownership is resolved from the authenticated user's own cart, never from a
// client-supplied cart id. A miss is a 404 (not a 403) so probing another user's
// item id reveals nothing about whether it exists.
const findOwnedCartItemOrThrow = async (
    userId: string,
    itemId: string,
): Promise<{ id: string }> => {
    const cart = await prisma.cart.findUnique({
        where: { userId },
        select: { id: true },
    });

    if (!cart) {
        throw new AppError(status.NOT_FOUND, "Cart item not found");
    }

    const item = await prisma.cartItem.findFirst({
        where: { id: itemId, cartId: cart.id },
        select: { id: true },
    });

    if (!item) {
        throw new AppError(status.NOT_FOUND, "Cart item not found");
    }

    return item;
};

const addCartItem = async (
    user: IRequestUser,
    payload: IAddCartItemPayload,
): Promise<ICartView> => {
    const variant = await prisma.productVariant.findFirst({
        where: { id: payload.variantId, isDeleted: false },
        include: {
            product: {
                select: {
                    id: true,
                    status: true,
                    isActive: true,
                    isDeleted: true,
                },
            },
        },
    });

    if (!variant) {
        throw new AppError(status.NOT_FOUND, "Product variant not found");
    }

    // An unpublished SKU cannot be added to a cart: the catalogue hides it for a
    // reason, and accepting it would let a client park stock that is not for sale.
    if (
        !variant.isActive ||
        variant.product.isDeleted ||
        !variant.product.isActive ||
        variant.product.status !== ProductStatus.ACTIVE
    ) {
        throw new AppError(
            status.BAD_REQUEST,
            "This product variant is not available for purchase",
        );
    }

    // One cart per user: created lazily on the first write so a read never
    // mutates anything.
    const cart = await prisma.cart.upsert({
        where: { userId: user.userId },
        create: { userId: user.userId },
        update: {},
        select: { id: true },
    });

    // Repeated additions of the same variant consolidate into the single row the
    // unique (cartId, variantId) constraint allows, instead of failing or
    // creating duplicates.
    const existing = await prisma.cartItem.findUnique({
        where: {
            uniq_cart_item_cart_variant: {
                cartId: cart.id,
                variantId: payload.variantId,
            },
        },
        select: { quantity: true },
    });

    const nextQuantity = (existing?.quantity ?? 0) + payload.quantity;

    if (nextQuantity > MAX_CART_ITEM_QUANTITY) {
        throw new AppError(
            status.BAD_REQUEST,
            `You can add at most ${MAX_CART_ITEM_QUANTITY} units of a single variant to your cart`,
        );
    }

    await prisma.cartItem.upsert({
        where: {
            uniq_cart_item_cart_variant: {
                cartId: cart.id,
                variantId: payload.variantId,
            },
        },
        create: {
            cartId: cart.id,
            variantId: payload.variantId,
            quantity: payload.quantity,
        },
        update: { quantity: nextQuantity },
    });

    return getCart(user);
};

const updateCartItemQuantity = async (
    user: IRequestUser,
    itemId: string,
    payload: IUpdateCartItemPayload,
): Promise<ICartView> => {
    const item = await findOwnedCartItemOrThrow(user.userId, itemId);

    await prisma.cartItem.update({
        where: { id: item.id },
        data: { quantity: payload.quantity },
    });

    return getCart(user);
};

const removeCartItem = async (
    user: IRequestUser,
    itemId: string,
): Promise<ICartView> => {
    const cart = await prisma.cart.findUnique({
        where: { userId: user.userId },
        select: { id: true },
    });

    if (!cart) {
        throw new AppError(status.NOT_FOUND, "Cart item not found");
    }

    // The ownership scope is part of the DELETE itself, so no update can happen
    // unless the row belongs to the caller's cart.
    const deleted = await prisma.cartItem.deleteMany({
        where: { id: itemId, cartId: cart.id },
    });

    if (deleted.count === 0) {
        throw new AppError(status.NOT_FOUND, "Cart item not found");
    }

    return getCart(user);
};

const clearCart = async (user: IRequestUser): Promise<ICartView> => {
    const cart = await prisma.cart.findUnique({
        where: { userId: user.userId },
        select: { id: true },
    });

    if (cart) {
        await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    }

    return getCart(user);
};

export const CartService = {
    getCart,
    addCartItem,
    updateCartItemQuantity,
    removeCartItem,
    clearCart,
};
