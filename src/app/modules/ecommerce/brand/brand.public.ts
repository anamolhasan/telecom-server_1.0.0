import type { Brand } from "../../../../generated/prisma/client";

// The public, unauthenticated projection of a brand. Explicit allowlist so
// internal bookkeeping columns (isDeleted, deletedAt) can never leak.
export interface IPublicBrand {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    logo: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export function toPublicBrand(brand: Brand): IPublicBrand {
    return {
        id: brand.id,
        name: brand.name,
        slug: brand.slug,
        description: brand.description ?? null,
        logo: brand.logo ?? null,
        isActive: brand.isActive,
        createdAt: brand.createdAt,
        updatedAt: brand.updatedAt,
    };
}

export function toPublicBrands(brands: Brand[]): IPublicBrand[] {
    return brands.map((brand) => toPublicBrand(brand));
}
