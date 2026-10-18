import type { Category } from "../../../../generated/prisma/client";

export interface ICategorySummary {
    id: string;
    name: string;
    slug: string;
    isActive: boolean;
}

export type CategoryWithHierarchy = Category & {
    parent?: ICategorySummary | null;
    children?: ICategorySummary[];
};

// The public, unauthenticated projection of a category. It is an explicit
// allowlist so internal bookkeeping columns (isDeleted, deletedAt) can never leak
// through public reads even if the model grows new ones.
export interface IPublicCategory {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    image: string | null;
    parentId: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    parent: ICategorySummary | null;
    children: ICategorySummary[];
}

export function toPublicCategory(category: CategoryWithHierarchy): IPublicCategory {
    return {
        id: category.id,
        name: category.name,
        slug: category.slug,
        description: category.description ?? null,
        image: category.image ?? null,
        parentId: category.parentId ?? null,
        isActive: category.isActive,
        createdAt: category.createdAt,
        updatedAt: category.updatedAt,
        parent: category.parent ?? null,
        children: category.children ?? [],
    };
}

export function toPublicCategories(
    categories: CategoryWithHierarchy[],
): IPublicCategory[] {
    return categories.map((category) => toPublicCategory(category));
}
