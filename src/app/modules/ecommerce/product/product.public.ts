import type { Product } from "../../../../generated/prisma/client";
import type { ProductStatus } from "../../../../generated/prisma/enums";
import {
    toAdminProductVariant,
    toPublicProductVariant,
    type IProductVariantView,
    type IPublicProductVariantView,
    type ProductVariantWithRelations,
} from "../productVariant/productVariant.public";

export interface IProductRefSummary {
    id: string;
    name: string;
    slug: string;
    isActive: boolean;
    isDeleted: boolean;
}

export interface IProductImageView {
    id: string;
    url: string;
    publicId: string | null;
    altText: string | null;
    position: number;
}

export type ProductWithRelations = Product & {
    category?: IProductRefSummary | null;
    brand?: IProductRefSummary | null;
    images?: Array<{
        id: string;
        url: string;
        publicId: string | null;
        altText: string | null;
        position: number;
    }>;
    variants?: ProductVariantWithRelations[];
};

// Administrative projection: every column plus the gallery, variants (with their
// stock) and the classification summaries. No money lives on this model, so only
// the nested variants need Decimal serialisation.
export interface IProductView {
    id: string;
    name: string;
    slug: string;
    description: string;
    categoryId: string;
    brandId: string | null;
    status: ProductStatus;
    isActive: boolean;
    isDeleted: boolean;
    deletedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    images: IProductImageView[];
    variants: IProductVariantView[];
    category: IProductRefSummary | null;
    brand: IProductRefSummary | null;
}

// Public projection: internal bookkeeping (isDeleted, deletedAt) and the
// variant reorder threshold are dropped, and a soft-deleted classification is
// presented as absent instead of dangling.
export interface IPublicProductView {
    id: string;
    name: string;
    slug: string;
    description: string;
    categoryId: string;
    brandId: string | null;
    status: ProductStatus;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    images: IProductImageView[];
    variants: IPublicProductVariantView[];
    category: IProductRefSummary | null;
    brand: IProductRefSummary | null;
}

const toProductRefSummary = (
    ref: IProductRefSummary | null | undefined,
    includeUnpublished: boolean,
): IProductRefSummary | null => {
    if (!ref) return null;
    if (!includeUnpublished && ref.isDeleted) return null;
    return ref;
};

export function toAdminProduct(product: ProductWithRelations): IProductView {
    return {
        id: product.id,
        name: product.name,
        slug: product.slug,
        description: product.description,
        categoryId: product.categoryId,
        brandId: product.brandId ?? null,
        status: product.status,
        isActive: product.isActive,
        isDeleted: product.isDeleted,
        deletedAt: product.deletedAt ?? null,
        createdAt: product.createdAt,
        updatedAt: product.updatedAt,
        images: (product.images ?? []).map((image) => ({
            id: image.id,
            url: image.url,
            publicId: image.publicId ?? null,
            altText: image.altText ?? null,
            position: image.position,
        })),
        variants: (product.variants ?? []).map((variant) =>
            toAdminProductVariant(variant),
        ),
        category: toProductRefSummary(product.category, true),
        brand: toProductRefSummary(product.brand, true),
    };
}

export function toPublicProduct(view: IProductView): IPublicProductView {
    return {
        id: view.id,
        name: view.name,
        slug: view.slug,
        description: view.description,
        categoryId: view.categoryId,
        brandId: view.brandId,
        status: view.status,
        isActive: view.isActive,
        createdAt: view.createdAt,
        updatedAt: view.updatedAt,
        images: view.images,
        variants: view.variants.map((variant) =>
            toPublicProductVariant(variant),
        ),
        category: toProductRefSummary(view.category, false),
        brand: toProductRefSummary(view.brand, false),
    };
}

export function toPublicProducts(views: IProductView[]): IPublicProductView[] {
    return views.map((view) => toPublicProduct(view));
}
