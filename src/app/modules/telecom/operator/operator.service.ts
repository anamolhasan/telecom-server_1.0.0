import status from "http-status";
import { Operator } from "../../../../generated/prisma/client";
import AppError from "../../../errorHelpers/AppError";
import { IQueryParams, PrismaModelDelegate } from "../../../interfaces/query.interface";
import { prisma } from "../../../lib/prisma";
import { QueryBuilder } from "../../../utils/QueryBuilder";
import { deleteImageByPublicId } from "../../upload/cloudinary.service";
import { ICreateOperatorPayload, IUpdateOperatorPayload } from "./operator.interface";

const isBlank = (value: string | undefined) =>
    value === undefined || value.trim() === "";

const assertLogoFieldsAreWellFormed = (payload: ICreateOperatorPayload | IUpdateOperatorPayload) => {
    if (payload.logo !== undefined && isBlank(payload.logo)) {
        throw new AppError(status.BAD_REQUEST, "Invalid logo.");
    }

    if (payload.logoPublicId !== undefined && isBlank(payload.logoPublicId)) {
        throw new AppError(status.BAD_REQUEST, "Invalid logoPublicId.");
    }
};

const assertLogoReferencePair = (payload: ICreateOperatorPayload) => {
    if (payload.logo !== undefined && payload.logoPublicId === undefined) {
        throw new AppError(
            status.BAD_REQUEST,
            "logoPublicId is required when logo is provided.",
        );
    }

    if (payload.logoPublicId !== undefined && payload.logo === undefined) {
        throw new AppError(
            status.BAD_REQUEST,
            "logo must be provided together with logoPublicId.",
        );
    }
};

// Cleanup contract (see `cleanupReplacedLogoAsset`): the asset we are allowed
// to remove is the handle we read from the stored row, never a value supplied
// by the request, and only when the stored logo URL actually moved.
const assertUpdateLogoReference = (
    payload: IUpdateOperatorPayload,
    existing: Operator,
) => {
    if (payload.logoPublicId !== undefined && payload.logo === undefined) {
        throw new AppError(
            status.BAD_REQUEST,
            "logo must be provided together with logoPublicId.",
        );
    }

    const logoChanged = payload.logo !== undefined && payload.logo !== existing.logo;

    if (logoChanged && payload.logoPublicId === undefined) {
        throw new AppError(
            status.BAD_REQUEST,
            "logoPublicId is required when changing the operator logo.",
        );
    }
};

interface ReplacedLogoCleanupParams {
    operatorId: string;
    previousLogo: string | null;
    previousPublicId: string | null;
    nextLogo: string | null;
    nextPublicId: string | null;
}

// Best-effort removal of the asset that a logo replacement left behind.
//
// Ordering guarantee: this runs only after `prisma.$transaction` resolved, so a
// failed database update can never reach the deletion call. Every branch that
// cannot prove the asset is unreferenced returns without deleting.
const cleanupReplacedLogoAsset = async (params: ReplacedLogoCleanupParams) => {
    const { operatorId, previousLogo, previousPublicId, nextLogo, nextPublicId } = params;

    // 1. Legacy rows have no handle: ownership of the underlying asset cannot
    //    be verified, so it is left in place (and no public id is guessed).
    if (previousPublicId === null || previousPublicId === "") return;

    // 2. Identical handles, or the URL did not actually move: this row still
    //    points at the very same asset.
    if (previousPublicId === nextPublicId) return;
    if (previousLogo !== null && previousLogo === nextLogo) return;

    // 3. Another operator may still render this asset - either by handle or by
    //    the same secure URL (covers legacy rows whose handle is null). A null
    //    result means the status is uncertain, so nothing is deleted.
    const references = await prisma.operator
        .count({
            where: {
                NOT: { id: operatorId },
                OR: [
                    { logoPublicId: previousPublicId },
                    ...(previousLogo ? [{ logo: previousLogo }] : []),
                ],
            },
        })
        .catch(() => null);

    if (references === null || references > 0) return;

    try {
        await deleteImageByPublicId(previousPublicId);
    } catch {
        // The replacement is already durable; a provider failure must not be
        // reverted and must not leak provider internals to the caller.
        console.warn("[operator-logo] replaced logo asset cleanup skipped");
    }
};

const createOperator = async (payload: ICreateOperatorPayload) => {
    assertLogoFieldsAreWellFormed(payload);
    assertLogoReferencePair(payload);

    return prisma.operator.create({ data: payload });
};

const getAllOperators = async (query: IQueryParams) => {
    const queryBuilder = new QueryBuilder<Operator>(
        prisma.operator as unknown as PrismaModelDelegate,
        query,
        {
            searchableFields: ["name", "code"],
            filterableFields: ["isActive", "isDeleted"],
        },
    );

    return queryBuilder.search().filter().sort().paginate().fields().execute();
};

const getOperatorById = async (id: string) => {
    const operator = await prisma.operator.findFirst({
        where: { id, isDeleted: false },
    });

    if (!operator) {
        throw new AppError(status.NOT_FOUND, "Operator not found");
    }

    return operator;
};

const updateOperator = async (id: string, payload: IUpdateOperatorPayload) => {
    // Read + write in one transaction so the previous public id we capture is
    // the same row we then overwrite.
    const { updated, previousLogo, previousPublicId } = await prisma.$transaction(
        async (tx) => {
            const existing = await tx.operator.findFirst({
                where: { id, isDeleted: false },
            });

            if (!existing) {
                throw new AppError(status.NOT_FOUND, "Operator not found");
            }

            assertLogoFieldsAreWellFormed(payload);
            assertUpdateLogoReference(payload, existing);

            const record = await tx.operator.update({ where: { id }, data: payload });

            return {
                updated: record,
                previousLogo: existing.logo,
                previousPublicId: existing.logoPublicId,
            };
        },
    );

    // Only reached when the update committed. Remaining race condition: the
    // reference check below is not serialised with a concurrent insert/update
    // that could adopt this asset between the check and the destroy call. The
    // window is a single pair of statements immediately before deletion, and
    // only handles already stored in our own database are ever deleted.
    await cleanupReplacedLogoAsset({
        operatorId: id,
        previousLogo,
        previousPublicId,
        nextLogo: updated.logo,
        nextPublicId: updated.logoPublicId,
    });

    return updated;
};

const deleteOperator = async (id: string) => {
    await getOperatorById(id);
    return prisma.operator.update({
        where: { id },
        data: { isDeleted: true, deletedAt: new Date() },
    });
};

export const OperatorService = {
    createOperator,
    getAllOperators,
    getOperatorById,
    updateOperator,
    deleteOperator,
};
