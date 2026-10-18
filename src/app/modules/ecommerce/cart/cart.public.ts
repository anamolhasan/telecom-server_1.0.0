import type { Cart, CartItem } from "../../../../generated/prisma/client";
import { ProductStatus } from "../../../../generated/prisma/enums";
import {
    centsToMoney,
    toMoneyCents,
    toMoneyNumber,
    toNullableMoneyNumber,
} from "../ecommerce.utils";

export interface ICartProductSummary {
    id: string;
    name: string;
    slug: string;
    status: ProductStatus;
    isActive: boolean;
    isDeleted: boolean;
}

export type CartVariantWithRelations = {
    id: string;
    sku: string;
    name: string | null;
    // Prisma Decimal; converted to a number in the view.
    price: unknown;
    compareAtPrice: unknown;
    isActive: boolean;
    isDeleted: boolean;
    inventory?: { availableQuantity: number } | null;
    product?: ICartProductSummary | null;
};

export type CartItemWithVariant = CartItem & {
    variant?: CartVariantWithRelations | null;
};

export type CartWithItems = Cart & {
    items?: CartItemWithVariant[];
};

export interface ICartVariantView {
    id: string;
    sku: string;
    name: string | null;
    price: number;
    compareAtPrice: number | null;
    isActive: boolean;
    isDeleted: boolean;
    availableQuantity: number | null;
    inStock: boolean;
    // Whether the line could be checked out today. Stock is intentionally not
    // part of this signal: a cart never reserves stock, so availability is a
    // catalogue question and the authoritative stock check happens at checkout.
    isAvailable: boolean;
    product: ICartProductSummary | null;
}

export interface ICartItemView {
    id: string;
    variantId: string;
    quantity: number;
    unitPrice: number;
    compareAtPrice: number | null;
    lineTotal: number;
    variant: ICartVariantView | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface ICartView {
    id: string | null;
    userId: string;
    items: ICartItemView[];
    // Distinct lines vs. total units, so a client never has to guess.
    itemCount: number;
    unitCount: number;
    subtotal: number;
    createdAt: Date | null;
    updatedAt: Date | null;
}

const isPurchasable = (variant: CartVariantWithRelations): boolean => {
    const product = variant.product;

    return (
        variant.isActive &&
        !variant.isDeleted &&
        product != null &&
        product.isActive &&
        !product.isDeleted &&
        product.status === ProductStatus.ACTIVE
    );
};

const computeCartItem = (
    item: CartItemWithVariant,
): { view: ICartItemView; lineTotalCents: number } | null => {
    const variant = item.variant;

    if (!variant) return null;

    const unitPrice = toMoneyNumber(variant.price);
    const lineTotalCents = toMoneyCents(variant.price) * item.quantity;

    return {
        lineTotalCents,
        view: {
            id: item.id,
            variantId: item.variantId,
            quantity: item.quantity,
            unitPrice,
            compareAtPrice: toNullableMoneyNumber(variant.compareAtPrice),
            lineTotal: centsToMoney(lineTotalCents),
            variant: {
                id: variant.id,
                sku: variant.sku,
                name: variant.name ?? null,
                price: unitPrice,
                compareAtPrice: toNullableMoneyNumber(variant.compareAtPrice),
                isActive: variant.isActive,
                isDeleted: variant.isDeleted,
                availableQuantity: variant.inventory?.availableQuantity ?? null,
                inStock: (variant.inventory?.availableQuantity ?? 0) > 0,
                isAvailable: isPurchasable(variant),
                product: variant.product ?? null,
            },
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
        },
    };
};

export const emptyCartView = (userId: string): ICartView => ({
    id: null,
    userId,
    items: [],
    itemCount: 0,
    unitCount: 0,
    subtotal: 0,
    createdAt: null,
    updatedAt: null,
});

// The cart a user has not created yet reads as an empty cart rather than an
// error, and no row is written just because someone looked. Prices are summed in
// integer paisa so the displayed subtotal never drifts through float math.
export function toCartView(
    userId: string,
    cart: CartWithItems | null,
): ICartView {
    if (!cart) return emptyCartView(userId);

    const computed = (cart.items ?? [])
        .map((item) => computeCartItem(item))
        .filter(
            (
                entry,
            ): entry is { view: ICartItemView; lineTotalCents: number } =>
                entry !== null,
        );

    const subtotalCents = computed.reduce(
        (sum, entry) => sum + entry.lineTotalCents,
        0,
    );

    return {
        id: cart.id,
        userId,
        items: computed.map((entry) => entry.view),
        itemCount: computed.length,
        unitCount: computed.reduce(
            (sum, entry) => sum + entry.view.quantity,
            0,
        ),
        subtotal: centsToMoney(subtotalCents),
        createdAt: cart.createdAt,
        updatedAt: cart.updatedAt,
    };
}
