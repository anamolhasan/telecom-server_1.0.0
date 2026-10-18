import status from "http-status";
import type { Brand } from "../../../../generated/prisma/client";
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
    publishedBrandWhere,
} from "../catalog.access";
import type { ICreateBrandPayload, IUpdateBrandPayload } from "./brand.interface";

// Public callers may only narrow the catalogue, never widen it: status flags stay
// out of the allowed filter list and the visibility predicate is merged after
// the QueryBuilder ran.
const buildBrandFilterableFields = (includeUnpublished: boolean): string[] =>
    includeUnpublished ? ["isActive", "isDeleted"] : [];

const findBrandOrThrow = async (id: string): Promise<Brand> => {
    const brand = await prisma.brand.findFirst({
        where: { id, isDeleted: false },
    });

    if (!brand) {
        throw new AppError(status.NOT_FOUND, "Brand not found");
    }

    return brand;
};

const createBrand = async (payload: ICreateBrandPayload) =>
    prisma.brand.create({
        data: {
            name: payload.name,
            slug: payload.slug,
            description: payload.description ?? null,
            logo: payload.logo ?? null,
            logoPublicId: payload.logoPublicId ?? null,
            isActive: payload.isActive ?? true,
        },
    });

const getAllBrands = async (
    query: IQueryParams,
    role: Role | null | undefined,
) => {
    const includeUnpublished = canViewUnpublishedCatalog(role);

    const queryBuilder = new QueryBuilder<Brand>(
        prisma.brand as unknown as PrismaModelDelegate,
        query,
        {
            searchableFields: ["name", "slug"],
            filterableFields: buildBrandFilterableFields(includeUnpublished),
        },
    );

    const builder = queryBuilder.search().filter().sort().paginate().fields();

    if (!includeUnpublished) {
        builder.where({ ...publishedBrandWhere });
    }

    return builder.execute();
};

const getBrandById = async (id: string, role: Role | null | undefined) => {
    const includeUnpublished = canViewUnpublishedCatalog(role);

    const brand = await prisma.brand.findFirst({
        where: { id, isDeleted: false },
    });

    // An unpublished brand is reported as missing, never as forbidden: a public
    // caller must not learn that a draft brand exists.
    if (!brand) {
        throw new AppError(status.NOT_FOUND, "Brand not found");
    }

    if (!includeUnpublished && !brand.isActive) {
        throw new AppError(status.NOT_FOUND, "Brand not found");
    }

    return brand;
};

const updateBrand = async (id: string, payload: IUpdateBrandPayload) => {
    const existing = await findBrandOrThrow(id);

    const updated = await prisma.brand.update({
        where: { id },
        // Undefined keys are ignored by Prisma, so an absent field is never
        // overwritten.
        data: {
            name: payload.name,
            slug: payload.slug,
            description: payload.description,
            logo: payload.logo,
            logoPublicId: payload.logoPublicId,
            isActive: payload.isActive,
        },
    });

    if (payload.logo !== undefined) {
        // The replaced handle comes from the stored row we read, never from the
        // request body.
        await cleanupRemovedImageAssets(
            pickRemovedAssets(
                [{ url: existing.logo, publicId: existing.logoPublicId }],
                updated.logoPublicId ? [updated.logoPublicId] : [],
                updated.logo ? [updated.logo] : [],
            ),
            (asset) =>
                prisma.brand.count({
                    where: {
                        NOT: { id },
                        OR: [
                            { logoPublicId: asset.publicId },
                            { logo: asset.url },
                        ],
                    },
                }),
        );
    }

    return updated;
};

// Soft delete. Products keep their (now unpublished) brand reference and are
// free to be re-assigned, so no cascading write happens here.
const deleteBrand = async (id: string) => {
    await findBrandOrThrow(id);

    return prisma.brand.update({
        where: { id },
        data: { isDeleted: true, deletedAt: new Date(), isActive: false },
    });
};

export const BrandService = {
    createBrand,
    getAllBrands,
    getBrandById,
    updateBrand,
    deleteBrand,
};
