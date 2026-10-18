import type { Prisma, ProductVariant } from "../../../../generated/prisma/client";
import type { ProductStatus } from "../../../../generated/prisma/enums";
import { toMoneyNumber, toNullableMoneyNumber } from "../ecommerce.utils";

export interface IVariantProductSummary {
    id: string;
    name: string;
    slug: string;
    status: ProductStatus;
    isActive: boolean;
    isDeleted: boolean;
}

export type ProductVariantWithRelations = ProductVariant & {
    inventory?: { availableQuantity: number; lowStockThreshold: number | null } | null;
    product?: IVariantProductSummary | null;
};

// Administrative projection: every column, with Decimal money rendered as a
// number (the shape the existing modules expose to clients).
export interface IProductVariantView {
    id: string;
    productId: string;
    sku: string;
    name: string | null;
    attributes: Prisma.JsonValue | null;
    price: number;
    compareAtPrice: number | null;
    isActive: boolean;
    isDeleted: boolean;
    deletedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    availableQuantity: number | null;
    lowStockThreshold: number | null;
    inStock: boolean;
    product: IVariantProductSummary | null;
}

// Public projection: the same allowlist without the internal reorder threshold.
export type IPublicProductVariantView = Omit<
    IProductVariantView,
    "lowStockThreshold"
>;

const availableQuantityOf = (variant: ProductVariantWithRelations) =>
    variant.inventory?.availableQuantity ?? null;

export function toAdminProductVariant(
    variant: ProductVariantWithRelations,
): IProductVariantView {
    const availableQuantity = availableQuantityOf(variant);

    return {
        id: variant.id,
        productId: variant.productId,
        sku: variant.sku,
        name: variant.name ?? null,
        attributes: variant.attributes ?? null,
        price: toMoneyNumber(variant.price),
        compareAtPrice: toNullableMoneyNumber(variant.compareAtPrice),
        isActive: variant.isActive,
        isDeleted: variant.isDeleted,
        deletedAt: variant.deletedAt ?? null,
        createdAt: variant.createdAt,
        updatedAt: variant.updatedAt,
        availableQuantity,
        lowStockThreshold: variant.inventory?.lowStockThreshold ?? null,
        // A variant is never advertised as available until stock has actually
        // been recorded for it.
        inStock: (availableQuantity ?? 0) > 0,
        product: variant.product ?? null,
    };
}

export function toPublicProductVariant(
    view: IProductVariantView,
): IPublicProductVariantView {
    return {
        id: view.id,
        productId: view.productId,
        sku: view.sku,
        name: view.name,
        attributes: view.attributes,
        price: view.price,
        compareAtPrice: view.compareAtPrice,
        isActive: view.isActive,
        isDeleted: view.isDeleted,
        deletedAt: view.deletedAt,
        createdAt: view.createdAt,
        updatedAt: view.updatedAt,
        availableQuantity: view.availableQuantity,
        inStock: view.inStock,
        product: view.product,
    };
}

export function toPublicProductVariants(
    views: IProductVariantView[],
): IPublicProductVariantView[] {
    return views.map((view) => toPublicProductVariant(view));
}
