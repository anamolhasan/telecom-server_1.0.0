import status from "http-status";
import { Prisma } from "../../../../generated/prisma/client";
import type { ProductVariant } from "../../../../generated/prisma/client";
import type { Role } from "../../../../generated/prisma/enums";
import AppError from "../../../errorHelpers/AppError";
import {
    IQueryParams,
    PrismaModelDelegate,
} from "../../../interfaces/query.interface";
import { prisma } from "../../../lib/prisma";
import { QueryBuilder } from "../../../utils/QueryBuilder";
import {
    canViewUnpublishedCatalog,
    publishedProductWhere,
    publishedVariantWithProductWhere,
} from "../catalog.access";
import type {
    ICreateProductVariantPayload,
    IUpdateProductVariantPayload,
} from "./productVariant.interface";
import {
    toAdminProductVariant,
    type IProductVariantView,
    type ProductVariantWithRelations,
} from "./productVariant.public";
import { createProductVariantZodSchema } from "./productVariant.validation";

export const productVariantInclude = {
    inventory: { select: { availableQuantity: true, lowStockThreshold: true } },
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
} satisfies Prisma.ProductVariantInclude;

// `attributes` is a nullable Json column: Prisma requires `Prisma.DbNull` (not a
// bare null) to clear it, and `undefined` would silently keep the previous value.
const toAttributesInput = (
    attributes: Record<string, unknown> | null | undefined,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput =>
    attributes == null
        ? Prisma.DbNull
        : (attributes as unknown as Prisma.InputJsonValue);

// Public callers may only narrow the catalogue (e.g. by product), never widen it:
// status flags stay out of the allowed filter list and the visibility predicate
// is merged after the QueryBuilder ran.
const buildVariantFilterableFields = (includeUnpublished: boolean): string[] =>
    includeUnpublished ? ["productId", "isActive", "isDeleted"] : ["productId"];

const ensureProductExists = async (productId: string): Promise<void> => {
    const product = await prisma.product.findFirst({
        where: { id: productId, isDeleted: false },
        select: { id: true },
    });

    if (!product) {
        throw new AppError(status.NOT_FOUND, "Product not found");
    }
};

const createProductVariant = async (
    payload: ICreateProductVariantPayload,
): Promise<IProductVariantView> => {
    await ensureProductExists(payload.productId);

    const created = await prisma.productVariant.create({
        data: {
            productId: payload.productId,
            sku: payload.sku,
            name: payload.name ?? null,
            attributes: toAttributesInput(payload.attributes),
            price: payload.price,
            compareAtPrice: payload.compareAtPrice ?? null,
            isActive: payload.isActive ?? true,
            // The single inventory row (unique variantId) is created eagerly, so
            // later stock updates always target an existing row and stay atomic.
            inventory: {
                create: {
                    availableQuantity:
                        payload.inventory?.availableQuantity ?? 0,
                    lowStockThreshold:
                        payload.inventory?.lowStockThreshold ?? null,
                },
            },
        },
        include: productVariantInclude,
    });

    return toAdminProductVariant(created as ProductVariantWithRelations);
};

const getAllProductVariants = async (
    query: IQueryParams,
    role: Role | null | undefined,
) => {
    const includeUnpublished = canViewUnpublishedCatalog(role);

    const queryBuilder = new QueryBuilder<ProductVariant>(
        prisma.productVariant as unknown as PrismaModelDelegate,
        query,
        {
            searchableFields: ["sku", "name", "product.name"],
            filterableFields: buildVariantFilterableFields(includeUnpublished),
        },
    );

    const builder = queryBuilder
        .search()
        .filter()
        .include({ ...productVariantInclude })
        .sort()
        .paginate()
        .fields();

    if (!includeUnpublished) {
        builder.where({ ...publishedVariantWithProductWhere });
    }

    const result = await builder.execute();

    return {
        ...result,
        data: (result.data as unknown as ProductVariantWithRelations[]).map(
            (variant) => toAdminProductVariant(variant),
        ),
    };
};

const getProductVariantById = async (
    id: string,
    role: Role | null | undefined,
): Promise<IProductVariantView> => {
    const includeUnpublished = canViewUnpublishedCatalog(role);

    const variant = await prisma.productVariant.findFirst({
        where: {
            id,
            isDeleted: false,
            ...(includeUnpublished
                ? {}
                : { product: { ...publishedProductWhere } }),
        },
        include: productVariantInclude,
    });

    // An unpublished variant (or one whose product is not published) is reported
    // as missing, never as forbidden.
    if (!variant || (!includeUnpublished && !variant.isActive)) {
        throw new AppError(status.NOT_FOUND, "Product variant not found");
    }

    return toAdminProductVariant(variant as ProductVariantWithRelations);
};

const updateProductVariant = async (
    id: string,
    payload: IUpdateProductVariantPayload,
): Promise<IProductVariantView> => {
    const existing = await prisma.productVariant.findFirst({
        where: { id, isDeleted: false },
        include: productVariantInclude,
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Product variant not found");
    }

    // Merge the patch over the stored row and re-run the full create schema, so
    // cross-field rules (compare-at price) hold for the resulting state and not
    // just for the fields the client happened to send.
    const candidate = {
        ...toAdminProductVariant(existing as ProductVariantWithRelations),
        ...payload,
    };

    const parsed = createProductVariantZodSchema.safeParse(candidate);

    if (!parsed.success) {
        const first = parsed.error.issues[0];
        throw new AppError(
            status.BAD_REQUEST,
            first?.message ?? "Invalid product variant data",
        );
    }

    const parsedPayload = parsed.data;
    const updated = await prisma.productVariant.update({
        where: { id },
        data: {
            sku: parsedPayload.sku,
            name: parsedPayload.name ?? null,
            attributes: toAttributesInput(parsedPayload.attributes),
            price: parsedPayload.price,
            compareAtPrice: parsedPayload.compareAtPrice ?? null,
            isActive: parsedPayload.isActive ?? existing.isActive,
        },
        include: productVariantInclude,
    });

    return toAdminProductVariant(updated as ProductVariantWithRelations);
};

// Soft delete: the row and its stock record are preserved so carts, historical
// snapshots and reporting can still resolve the SKU.
const deleteProductVariant = async (id: string): Promise<IProductVariantView> => {
    const existing = await prisma.productVariant.findFirst({
        where: { id, isDeleted: false },
        select: { id: true },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Product variant not found");
    }

    const deleted = await prisma.productVariant.update({
        where: { id },
        data: { isDeleted: true, deletedAt: new Date(), isActive: false },
        include: productVariantInclude,
    });

    return toAdminProductVariant(deleted as ProductVariantWithRelations);
};

export const ProductVariantService = {
    createProductVariant,
    getAllProductVariants,
    getProductVariantById,
    updateProductVariant,
    deleteProductVariant,
};
