import status from "http-status";
import type { Category, Prisma } from "../../../../generated/prisma/client";
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
    publishedCategoryWhere,
} from "../catalog.access";
import type {
    ICreateCategoryPayload,
    IUpdateCategoryPayload,
} from "./category.interface";

// Safety valve for the self-referencing hierarchy walk. A tree deeper than this
// is already pathological, and the cap also guarantees the cycle check always
// terminates even if legacy data somehow contains a loop.
const MAX_CATEGORY_DEPTH = 50;

const categorySummarySelect = {
    id: true,
    name: true,
    slug: true,
    isActive: true,
} as const;

// A public caller sees only active branches; a content admin sees the whole
// (non-deleted) tree.
const buildCategoryDetailInclude = (
    includeUnpublished: boolean,
): Prisma.CategoryInclude => ({
    parent: { select: categorySummarySelect },
    children: {
        where: includeUnpublished
            ? { isDeleted: false }
            : { ...publishedCategoryWhere },
        select: categorySummarySelect,
        orderBy: { name: "asc" },
    },
});

// Public callers may only narrow the catalogue (e.g. by parent), never widen it:
// status flags stay out of the allowed filter list and the visibility predicate
// is merged after the QueryBuilder ran.
const buildCategoryFilterableFields = (includeUnpublished: boolean): string[] =>
    includeUnpublished ? ["parentId", "isActive", "isDeleted"] : ["parentId"];

const findCategoryOrThrow = async (id: string): Promise<Category> => {
    const category = await prisma.category.findFirst({
        where: { id, isDeleted: false },
    });

    if (!category) {
        throw new AppError(status.NOT_FOUND, "Category not found");
    }

    return category;
};

// Guards the self-referencing hierarchy: a category may never be its own parent
// and may never be re-parented under one of its own descendants, which would
// create a cycle the public tree could no longer traverse.
const assertParentCategoryIsValid = async (
    categoryId: string | null,
    parentId: string,
): Promise<void> => {
    if (categoryId !== null && categoryId === parentId) {
        throw new AppError(
            status.BAD_REQUEST,
            "A category cannot be its own parent",
        );
    }

    let cursor: string | null = parentId;
    const visited = new Set<string>();

    for (
        let depth = 0;
        depth < MAX_CATEGORY_DEPTH && cursor !== null;
        depth += 1
    ) {
        if (visited.has(cursor)) break;
        visited.add(cursor);

        const ancestor: {
            id: string;
            parentId: string | null;
            isDeleted: boolean;
        } | null = await prisma.category.findUnique({
            where: { id: cursor },
            select: { id: true, parentId: true, isDeleted: true },
        });

        if (!ancestor || ancestor.isDeleted) {
            throw new AppError(status.NOT_FOUND, "Parent category not found");
        }

        if (categoryId !== null && ancestor.id === categoryId) {
            throw new AppError(
                status.BAD_REQUEST,
                "A category cannot be nested under one of its own descendants",
            );
        }

        cursor = ancestor.parentId;
    }
};

const createCategory = async (payload: ICreateCategoryPayload) => {
    if (payload.parentId) {
        await assertParentCategoryIsValid(null, payload.parentId);
    }

    return prisma.category.create({
        data: {
            name: payload.name,
            slug: payload.slug,
            description: payload.description ?? null,
            image: payload.image ?? null,
            imagePublicId: payload.imagePublicId ?? null,
            parentId: payload.parentId ?? null,
            isActive: payload.isActive ?? true,
        },
    });
};

const getAllCategories = async (
    query: IQueryParams,
    role: Role | null | undefined,
) => {
    const includeUnpublished = canViewUnpublishedCatalog(role);

    const queryBuilder = new QueryBuilder<Category>(
        prisma.category as unknown as PrismaModelDelegate,
        query,
        {
            searchableFields: ["name", "slug"],
            filterableFields: buildCategoryFilterableFields(includeUnpublished),
        },
    );

    const builder = queryBuilder.search().filter().sort().paginate().fields();

    if (!includeUnpublished) {
        // Applied after filter() so the visibility constraints always win over
        // query-string filters.
        builder.where({ ...publishedCategoryWhere });
    }

    return builder.execute();
};

const getCategoryById = async (
    id: string,
    role: Role | null | undefined,
) => {
    const includeUnpublished = canViewUnpublishedCatalog(role);

    const category = await prisma.category.findFirst({
        where: { id, isDeleted: false },
        include: buildCategoryDetailInclude(includeUnpublished),
    });

    // An unpublished category is reported as missing, never as forbidden: a
    // public caller must not learn that a draft category exists.
    if (!category) {
        throw new AppError(status.NOT_FOUND, "Category not found");
    }

    if (!includeUnpublished && !category.isActive) {
        throw new AppError(status.NOT_FOUND, "Category not found");
    }

    return category;
};

const updateCategory = async (
    id: string,
    payload: IUpdateCategoryPayload,
) => {
    const existing = await findCategoryOrThrow(id);

    if (payload.parentId !== undefined && payload.parentId !== null) {
        await assertParentCategoryIsValid(id, payload.parentId);
    }

    const updated = await prisma.category.update({
        where: { id },
        // Undefined keys are ignored by Prisma, so an absent field is never
        // overwritten. Scalar `parentId` supports an explicit `null` (detach).
        data: {
            name: payload.name,
            slug: payload.slug,
            description: payload.description,
            image: payload.image,
            imagePublicId: payload.imagePublicId,
            parentId: payload.parentId,
            isActive: payload.isActive,
        },
    });

    if (payload.image !== undefined) {
        // The replaced handle comes from the stored row we read, never from the
        // request body.
        await cleanupRemovedImageAssets(
            pickRemovedAssets(
                [{ url: existing.image, publicId: existing.imagePublicId }],
                updated.imagePublicId ? [updated.imagePublicId] : [],
                updated.image ? [updated.image] : [],
            ),
            (asset) =>
                prisma.category.count({
                    where: {
                        NOT: { id },
                        OR: [
                            { imagePublicId: asset.publicId },
                            { image: asset.url },
                        ],
                    },
                }),
        );
    }

    return updated;
};

const deleteCategory = async (id: string) => {
    await findCategoryOrThrow(id);

    // Soft delete keeps history (and any catalog reference) intact, so it is
    // refused while the category is still in use.
    const [childCount, productCount] = await Promise.all([
        prisma.category.count({ where: { parentId: id, isDeleted: false } }),
        prisma.product.count({ where: { categoryId: id, isDeleted: false } }),
    ]);

    if (childCount > 0) {
        throw new AppError(
            status.BAD_REQUEST,
            "Re-assign or delete the child categories before deleting this category",
        );
    }

    if (productCount > 0) {
        throw new AppError(
            status.BAD_REQUEST,
            "Re-assign or delete the products in this category before deleting it",
        );
    }

    return prisma.category.update({
        where: { id },
        data: { isDeleted: true, deletedAt: new Date(), isActive: false },
    });
};

export const CategoryService = {
    createCategory,
    getAllCategories,
    getCategoryById,
    updateCategory,
    deleteCategory,
};
