import status from "http-status";
import { OperatorOffer } from "../../../generated/prisma/client";
import {
    OperatorOfferInventoryMode,
    OperatorOfferStatus,
    OperatorOfferType,
} from "../../../generated/prisma/enums";
import AppError from "../../errorHelpers/AppError";
import {
    IQueryParams,
    PrismaModelDelegate,
} from "../../interfaces/query.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import {
    computeOfferFinancials,
    OFFER_TYPE_TO_PRODUCT_TYPE,
} from "./operatorOffer.calculation";
import type {
    ICreateOperatorOfferPayload,
    IUpdateOperatorOfferPayload,
    OperatorOfferStatusAction,
} from "./operatorOffer.interface";
import { createOperatorOfferZodSchema } from "./operatorOffer.validation";

// Money columns are stored as Prisma Decimal; serialise them back to numbers so
// API responses keep the numeric shape the clients expect.
const MONEY_FIELDS = [
    "regularPrice",
    "discountValue",
    "companyPurchasePrice",
    "resellerCommissionValue",
    "agentCommissionValue",
] as const;

function serializeOperatorOffer<T extends Record<string, unknown>>(offer: T): T {
    const clone: Record<string, unknown> = { ...offer };

    for (const field of MONEY_FIELDS) {
        const value = clone[field];
        if (value !== null && value !== undefined) {
            clone[field] = Number(value);
        }
    }

    return clone as T;
}

const ensureOperatorExists = async (operatorId: string) => {
    const operator = await prisma.operator.findFirst({
        where: { id: operatorId, isDeleted: false },
    });

    if (!operator) {
        throw new AppError(status.NOT_FOUND, "Operator not found");
    }
};

interface ResolvedOfferConfig {
    offerType: OperatorOfferType;
    amount: number | null;
    amountUnit: ICreateOperatorOfferPayload["amountUnit"] | null;
    validityValue: number | null;
    validityUnit: ICreateOperatorOfferPayload["validityUnit"] | null;
    regularPrice: number;
    discountType: NonNullable<ICreateOperatorOfferPayload["discountType"]>;
    discountValue: number;
    companyPurchasePrice: number;
    resellerCommissionType: NonNullable<
        ICreateOperatorOfferPayload["resellerCommissionType"]
    >;
    resellerCommissionValue: number;
    agentCommissionType: NonNullable<
        ICreateOperatorOfferPayload["agentCommissionType"]
    >;
    agentCommissionValue: number;
    inventoryMode: NonNullable<ICreateOperatorOfferPayload["inventoryMode"]>;
    stockQuantity: number | null;
    badges: NonNullable<ICreateOperatorOfferPayload["badges"]>;
    status: NonNullable<ICreateOperatorOfferPayload["status"]>;
    isActive: boolean;
}

// Apply defaults and normalise the raw payload before any money is computed. The
// effectively selling price and commission amounts are derived here, never taken
// from the request.
function resolveOfferConfig(
    payload: ICreateOperatorOfferPayload,
): ResolvedOfferConfig {
    const offerType = payload.offerType ?? OperatorOfferType.OTHER;
    const inventoryMode =
        payload.inventoryMode ?? OperatorOfferInventoryMode.UNLIMITED;
    const status = payload.status ?? OperatorOfferStatus.DRAFT;

    return {
        offerType,
        amount: payload.amount ?? null,
        amountUnit: payload.amountUnit ?? null,
        validityValue: payload.validityValue ?? null,
        validityUnit: payload.validityUnit ?? null,
        regularPrice: payload.regularPrice,
        discountType: payload.discountType ?? "NONE",
        discountValue: payload.discountValue ?? 0,
        companyPurchasePrice: payload.companyPurchasePrice ?? 0,
        resellerCommissionType: payload.resellerCommissionType ?? "FIXED",
        resellerCommissionValue: payload.resellerCommissionValue ?? 0,
        agentCommissionType: payload.agentCommissionType ?? "FIXED",
        agentCommissionValue: payload.agentCommissionValue ?? 0,
        inventoryMode,
        stockQuantity:
            inventoryMode === OperatorOfferInventoryMode.LIMITED
                ? (payload.stockQuantity ?? 0)
                : null,
        badges: payload.badges ?? [],
        status,
        isActive: status === OperatorOfferStatus.ACTIVE,
    };
}

function buildPersistData(
    operatorId: string,
    name: string,
    description: string | undefined,
    resolved: ResolvedOfferConfig,
    startsAt: Date,
    endsAt: Date,
) {
    const computed = computeOfferFinancials({
        regularPrice: resolved.regularPrice,
        discountType: resolved.discountType,
        discountValue: resolved.discountValue,
        companyPurchasePrice: resolved.companyPurchasePrice,
        resellerCommission: {
            type: resolved.resellerCommissionType,
            value: resolved.resellerCommissionValue,
        },
        agentCommission: {
            type: resolved.agentCommissionType,
            value: resolved.agentCommissionValue,
        },
    });

    return {
        operatorId,
        name,
        description: description ?? null,
        offerType: resolved.offerType,
        // Legacy classification mirrored from the rich offer type for backward
        // compatibility with existing order/reporting consumers.
        type: OFFER_TYPE_TO_PRODUCT_TYPE[resolved.offerType],
        amount: resolved.amount,
        amountUnit: resolved.amountUnit,
        validityValue: resolved.validityValue,
        validityUnit: resolved.validityUnit,
        regularPrice: resolved.regularPrice,
        // Authoritative selling price used by orders.
        price: computed.sellingPrice,
        discountType: resolved.discountType,
        discountValue: resolved.discountValue,
        companyPurchasePrice: resolved.companyPurchasePrice,
        resellerCommissionType: resolved.resellerCommissionType,
        resellerCommissionValue: resolved.resellerCommissionValue,
        agentCommissionType: resolved.agentCommissionType,
        agentCommissionValue: resolved.agentCommissionValue,
        // Percentage rate consumed by the order/commission flow.
        commissionRate: computed.commissionRate,
        inventoryMode: resolved.inventoryMode,
        stockQuantity: resolved.stockQuantity,
        badges: resolved.badges,
        startsAt,
        endsAt,
        status: resolved.status,
        isActive: resolved.isActive,
    };
}

const createOperatorOffer = async (payload: ICreateOperatorOfferPayload) => {
    await ensureOperatorExists(payload.operatorId);

    const resolved = resolveOfferConfig(payload);
    const data = buildPersistData(
        payload.operatorId,
        payload.name,
        payload.description,
        resolved,
        payload.startsAt,
        payload.endsAt,
    );

    const created = await prisma.operatorOffer.create({
        data,
        include: { operator: true },
    });

    return serializeOperatorOffer(created);
};

const getAllOperatorOffers = async (query: IQueryParams) => {
    const queryBuilder = new QueryBuilder<OperatorOffer>(
        prisma.operatorOffer as unknown as PrismaModelDelegate,
        query,
        {
            searchableFields: ["name", "operator.name"],
            filterableFields: [
                "operatorId",
                "offerType",
                "type",
                "status",
                "inventoryMode",
                "isActive",
                "isDeleted",
            ],
        },
    );

    const result = await queryBuilder
        .search()
        .filter()
        .include({ operator: true })
        .sort()
        .paginate()
        .fields()
        .execute();

    return {
        ...result,
        data: result.data.map((offer) =>
            serializeOperatorOffer(offer as unknown as Record<string, unknown>),
        ) as OperatorOffer[],
    };
};

const getOperatorOfferById = async (id: string) => {
    const offer = await prisma.operatorOffer.findFirst({
        where: { id, isDeleted: false },
        include: { operator: true },
    });

    if (!offer) {
        throw new AppError(status.NOT_FOUND, "Operator offer not found");
    }

    return serializeOperatorOffer(offer);
};

const updateOperatorOffer = async (
    id: string,
    payload: IUpdateOperatorOfferPayload,
) => {
    const existing = await prisma.operatorOffer.findFirst({
        where: { id, isDeleted: false },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Operator offer not found");
    }

    if (payload.operatorId) {
        await ensureOperatorExists(payload.operatorId);
    }

    // Merge over the existing row and re-run the full create schema so cross-field
    // business rules hold for the resulting state, not just the patch.
    const candidate = {
        ...serializeOperatorOffer(existing as unknown as Record<string, unknown>),
        ...payload,
    };

    const parsed = createOperatorOfferZodSchema.safeParse(candidate);

    if (!parsed.success) {
        const first = parsed.error.issues[0];
        throw new AppError(
            status.BAD_REQUEST,
            first?.message ?? "Invalid operator offer data",
        );
    }

    const parsedPayload = parsed.data as ICreateOperatorOfferPayload;
    const resolved = resolveOfferConfig(parsedPayload);
    const data = buildPersistData(
        parsedPayload.operatorId,
        parsedPayload.name,
        parsedPayload.description,
        resolved,
        parsedPayload.startsAt,
        parsedPayload.endsAt,
    );

    const updated = await prisma.operatorOffer.update({
        where: { id },
        data,
        include: { operator: true },
    });

    return serializeOperatorOffer(updated);
};

const changeOperatorOfferStatus = async (
    id: string,
    action: OperatorOfferStatusAction,
) => {
    const offer = await prisma.operatorOffer.findFirst({
        where: { id, isDeleted: false },
    });

    if (!offer) {
        throw new AppError(status.NOT_FOUND, "Operator offer not found");
    }

    if (action === "pause") {
        if (offer.status !== OperatorOfferStatus.ACTIVE) {
            throw new AppError(
                status.BAD_REQUEST,
                "Only active offers can be paused",
            );
        }

        const paused = await prisma.operatorOffer.update({
            where: { id },
            data: { status: OperatorOfferStatus.PAUSED, isActive: false },
            include: { operator: true },
        });

        return serializeOperatorOffer(paused);
    }

    if (action === "resume") {
        if (offer.status !== OperatorOfferStatus.PAUSED) {
            throw new AppError(
                status.BAD_REQUEST,
                "Only paused offers can be resumed",
            );
        }

        const resumed = await prisma.operatorOffer.update({
            where: { id },
            data: { status: OperatorOfferStatus.ACTIVE, isActive: true },
            include: { operator: true },
        });

        return serializeOperatorOffer(resumed);
    }

    // archive: soft delete, preserving the row and all historical orders.
    const archived = await prisma.operatorOffer.update({
        where: { id },
        data: {
            isDeleted: true,
            deletedAt: new Date(),
            isActive: false,
        },
        include: { operator: true },
    });

    return serializeOperatorOffer(archived);
};

const archiveOperatorOffer = (id: string) =>
    changeOperatorOfferStatus(id, "archive");

export const OperatorOfferService = {
    createOperatorOffer,
    getAllOperatorOffers,
    getOperatorOfferById,
    updateOperatorOffer,
    changeOperatorOfferStatus,
    archiveOperatorOffer,
};
