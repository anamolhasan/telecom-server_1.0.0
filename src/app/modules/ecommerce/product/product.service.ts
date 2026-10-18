import status from "http-status";
import type { Prisma, Product } from "../../../../generated/prisma/client";
import { ProductStatus } from "../../../../generated/prisma/enums";
import type { Role } from "../../../../generated/prisma/enums";
import AppError from "../../../errorHelpers/AppError";
import {
    IQueryParams,
    PrismaModelDelegate,
} from "../../../interfaces/query.interface";
import { prisma } from "../../../lib/prisma";
import { QueryBuilder } from "../../../utils/QueryBuilder";
import { cleanupRemovedImageAssets, pickRemovedAssets } from "../asset.cleanup";
import {
    canViewUnpublishedCatalog,
    publishedProductWhere,
    publishedVariantWhere,
} from "../catalog.access";
import { productVariantInclude } from "../productVariant/productVariant.service";
import type {
    ICreateProductPayload,
    IProductImagePayload,
    IUpdateProductPayload,
} from "./product.interface";
import {
    toAdminProduct,
    type IProductView,
    type ProductWithRelations,
} from "./product.public";

// Summary columns returned for the category/brand a product belongs to. Kept in
// one place so both relation includes stay in sync.
const productRefSelect = {
    id: true,
    name: true,
    slug: true,
    isActive: true,
    isDeleted: true,
} as const;

// Public callers may only narrow the catalogue (e.g. by category), never widen
// it: status flags stay out of the allowed filter list and the visibility
// predicate is merged after the QueryBuilder ran.
const buildProductFilterableFields = (includeUnpublished: boolean): string[] =>
    includeUnpublished
        ? ["categoryId", "brandId", "status", "isActive", "isDeleted"]
        : ["categoryId", "brandId"];

// A public read only ever sees published variants (and a soft-deleted variant
// stays visible to a content admin so it can be un-archived).
const buildProductDetailInclude = (
    includeUnpublished: boolean,
): Prisma.ProductInclude => ({
    category: { select: productRefSelect },
    brand: { select: productRefSelect },
    images: { orderBy: { position: "asc" } },
    variants: includeUnpublished
        ? {
              include: productVariantInclude,
              orderBy: { createdAt: "asc" },
          }
        : {
              where: { ...publishedVariantWhere },
              include: productVariantInclude,
              orderBy: { createdAt: "asc" },
          },
});

const toImageCreateData = (images: IProductImagePayload[]) =>
    images.map((image, index) => ({
        url: image.url,
        publicId: image.publicId ?? null,
        altText: image.altText ?? null,
        position: image.position ?? index,
    }));

const ensureCategoryExists = async (categoryId: string): Promise<void> => {
    const category = await prisma.category.findFirst({
        where: { id: categoryId, isDeleted: false },
        select: { id: true },
    });

    if (!category) {
        throw new AppError(status.NOT_FOUND, "Category not found");
    }
};

const ensureBrandExists = async (brandId: string): Promise<void> => {
    const brand = await prisma.brand.findFirst({
        where: { id: brandId, isDeleted: false },
        select: { id: true },
    });

    if (!brand) {
        throw new AppError(status.NOT_FOUND, "Brand not found");
    }
};

const findProductOrThrow = async (id: string): Promise<Product> => {
    const product = await prisma.product.findFirst({
        where: { id, isDeleted: false },
    });

    if (!product) {
        throw new AppError(status.NOT_FOUND, "Product not found");
    }

    return product;
};

const createProduct = async (
    payload: ICreateProductPayload,
): Promise<IProductView> => {
    await ensureCategoryExists(payload.categoryId);

    if (payload.brandId) {
        await ensureBrandExists(payload.brandId);
    }

    const status = payload.status ?? ProductStatus.DRAFT;

    const created = await prisma.product.create({
        data: {
            name: payload.name,
            slug: payload.slug,
            description: payload.description,
            categoryId: payload.categoryId,
            brandId: payload.brandId ?? null,
            status,
            // Publishing is what makes a product publicly readable, so the two
            // fields are kept consistent on write (see catalog.access.ts).
            isActive: payload.isActive ?? status === ProductStatus.ACTIVE,
            images:
                payload.images && payload.images.length > 0
                    ? { create: toImageCreateData(payload.images) }
                    : undefined,
        },
        include: buildProductDetailInclude(true),
    });

    return toAdminProduct(created as ProductWithRelations);
};

const getAllProducts = async (
    query: IQueryParams,
    role: Role | null | undefined,
) => {
    const includeUnpublished = canViewUnpublishedCatalog(role);

    const queryBuilder = new QueryBuilder<Product>(
        prisma.product as unknown as PrismaModelDelegate,
        query,
        {
            searchableFields: ["name", "slug", "category.name", "brand.name"],
            filterableFields: buildProductFilterableFields(includeUnpublished),
        },
    );

    const builder = queryBuilder
        .search()
        .filter()
        .include({ ...buildProductDetailInclude(includeUnpublished) })
        .sort()
        .paginate()
        .fields();

    if (!includeUnpublished) {
        builder.where({ ...publishedProductWhere });
    }

    const result = await builder.execute();

    return {
        ...result,
        data: (result.data as unknown as ProductWithRelations[]).map(
            (product) => toAdminProduct(product),
        ),
    };
};

const getProductById = async (
    id: string,
    role: Role | null | undefined,
): Promise<IProductView> => {
    const includeUnpublished = canViewUnpublishedCatalog(role);

    const product = await prisma.product.findFirst({
        where: { id, isDeleted: false },
        include: buildProductDetailInclude(includeUnpublished),
    });

    // An unpublished product is reported as missing, never as forbidden: a
    // public caller must not learn that a draft product exists.
    if (!product) {
        throw new AppError(status.NOT_FOUND, "Product not found");
    }

    if (
        !includeUnpublished &&
        (!product.isActive || product.status !== ProductStatus.ACTIVE)
    ) {
        throw new AppError(status.NOT_FOUND, "Product not found");
    }

    return toAdminProduct(product as ProductWithRelations);
};

const updateProduct = async (
    id: string,
    payload: IUpdateProductPayload,
): Promise<IProductView> => {
    if (payload.categoryId !== undefined) {
        await ensureCategoryExists(payload.categoryId);
    }

    if (payload.brandId !== undefined && payload.brandId !== null) {
        await ensureBrandExists(payload.brandId);
    }

    const { updated, replacedImages } = await prisma.$transaction(
        async (tx) => {
            const existing = await tx.product.findFirst({
                where: { id, isDeleted: false },
            });

            if (!existing) {
                throw new AppError(status.NOT_FOUND, "Product not found");
            }

            const nextStatus = payload.status ?? existing.status;
            // Moving to/from ACTIVE keeps `isActive` in step unless the caller
            // explicitly asks for the other value.
            const nextIsActive =
                payload.isActive ??
                (payload.status !== undefined
                    ? nextStatus === ProductStatus.ACTIVE
                    : existing.isActive);

            // Captured inside the transaction, from the rows being replaced, so
            // any later media cleanup can never target a request value.
            const replacedImages =
                payload.images === undefined
                    ? []
                    : await tx.productImage.findMany({
                          where: { productId: id },
                          select: { url: true, publicId: true },
                      });

            await tx.product.update({
                where: { id },
                // Undefined keys are ignored by Prisma, so an absent field is
                // never overwritten. Scalar `brandId` supports an explicit null
                // (detach from the brand).
                data: {
                    name: payload.name,
                    slug: payload.slug,
                    description: payload.description,
                    categoryId: payload.categoryId,
                    brandId: payload.brandId,
                    status: payload.status,
                    isActive: nextIsActive,
                },
            });

            if (payload.images !== undefined) {
                await tx.productImage.deleteMany({ where: { productId: id } });

                if (payload.images.length > 0) {
                    await tx.productImage.createMany({
                        data: toImageCreateData(payload.images).map(
                            (image) => ({ ...image, productId: id }),
                        ),
                    });
                }
            }

            const saved = await tx.product.findUniqueOrThrow({
                where: { id },
                include: buildProductDetailInclude(true),
            });

            return { updated: saved, replacedImages };
        },
    );

    if (payload.images !== undefined) {
        await cleanupRemovedImageAssets(
            pickRemovedAssets(
                replacedImages,
                updated.images
                    .map((image) => image.publicId)
                    .filter((publicId): publicId is string => publicId !== null),
                updated.images.map((image) => image.url),
            ),
            (asset) =>
                prisma.productImage.count({
                    where: {
                        OR: [
                            { publicId: asset.publicId },
                            { url: asset.url },
                        ],
                    },
                }),
        );
    }

    return toAdminProduct(updated as ProductWithRelations);
};

// Archive (soft delete). Variants and gallery rows are preserved so historical
// records and reporting keep resolving the product; the visibility predicate in
// catalog.access.ts hides the whole tree from public reads because it joins the
// parent product's flags.
const deleteProduct = async (id: string): Promise<IProductView> => {
    await findProductOrThrow(id);

    const deleted = await prisma.product.update({
        where: { id },
        data: {
            isDeleted: true,
            deletedAt: new Date(),
            isActive: false,
            status: ProductStatus.ARCHIVED,
        },
        include: buildProductDetailInclude(true),
    });

    return toAdminProduct(deleted as ProductWithRelations);
};

export const ProductService = {
    createProduct,
    getAllProducts,
    getProductById,
    updateProduct,
    deleteProduct,
};
