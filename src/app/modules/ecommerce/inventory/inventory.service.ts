import status from "http-status";
import type { Inventory, Prisma } from "../../../../generated/prisma/client";
import AppError from "../../../errorHelpers/AppError";
import {
    IQueryParams,
    PrismaModelDelegate,
} from "../../../interfaces/query.interface";
import { prisma } from "../../../lib/prisma";
import { QueryBuilder } from "../../../utils/QueryBuilder";
import type {
    IAdjustInventoryPayload,
    ISetInventoryPayload,
} from "./inventory.interface";

// The owning variant/product summary, enough for an operations console to know
// what it is looking at. No money columns are selected, so nothing Decimal ever
// leaks into the response as a string.
const inventoryInclude = {
    variant: {
        select: {
            id: true,
            sku: true,
            name: true,
            isActive: true,
            isDeleted: true,
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
        },
    },
} satisfies Prisma.InventoryInclude;

const findVariantOrThrow = async (variantId: string): Promise<void> => {
    const variant = await prisma.productVariant.findFirst({
        where: { id: variantId, isDeleted: false },
        select: { id: true },
    });

    if (!variant) {
        throw new AppError(status.NOT_FOUND, "Product variant not found");
    }
};

const getAllInventory = async (query: IQueryParams) =>
    new QueryBuilder<Inventory>(
        prisma.inventory as unknown as PrismaModelDelegate,
        query,
        {
            searchableFields: [
                "variant.sku",
                "variant.name",
                "variant.product.name",
            ],
            filterableFields: ["variantId"],
        },
    )
        .search()
        .filter()
        .include({ ...inventoryInclude })
        .sort()
        .paginate()
        .fields()
        .execute();

const getInventoryByVariantId = async (variantId: string) => {
    const inventory = await prisma.inventory.findUnique({
        where: { variantId },
        include: inventoryInclude,
    });

    if (!inventory) {
        throw new AppError(
            status.NOT_FOUND,
            "Inventory record not found for this product variant",
        );
    }

    return inventory;
};

// Absolute set. The value is validated (whole number, non-negative) before it can
// reach the column, so this path cannot drive stock negative - and it is only
// reachable by an authorized content admin.
const setInventory = async (
    variantId: string,
    payload: ISetInventoryPayload,
) => {
    await findVariantOrThrow(variantId);

    return prisma.inventory.upsert({
        where: { variantId },
        create: {
            variantId,
            availableQuantity: payload.availableQuantity,
            lowStockThreshold: payload.lowStockThreshold ?? null,
        },
        update: {
            availableQuantity: payload.availableQuantity,
            lowStockThreshold: payload.lowStockThreshold ?? null,
        },
        include: inventoryInclude,
    });
};

// Relative adjustment. The floor check and the decrement are a single statement,
// so two concurrent decrements can never both pass the guard and oversell - the
// losing request is told the stock is insufficient instead of writing a negative
// value.
const adjustInventory = async (
    variantId: string,
    payload: IAdjustInventoryPayload,
) => {
    const inventory = await prisma.inventory.findUnique({
        where: { variantId },
        select: { variantId: true },
    });

    if (!inventory) {
        throw new AppError(
            status.NOT_FOUND,
            "Inventory record not found for this product variant",
        );
    }

    const { delta } = payload;

    if (delta < 0) {
        const updated = await prisma.inventory.updateMany({
            where: { variantId, availableQuantity: { gte: -delta } },
            data: { availableQuantity: { increment: delta } },
        });

        if (updated.count === 0) {
            throw new AppError(
                status.CONFLICT,
                "Insufficient stock for this adjustment",
            );
        }
    } else {
        await prisma.inventory.update({
            where: { variantId },
            data: { availableQuantity: { increment: delta } },
        });
    }

    return prisma.inventory.findUniqueOrThrow({
        where: { variantId },
        include: inventoryInclude,
    });
};

export const InventoryService = {
    getAllInventory,
    getInventoryByVariantId,
    setInventory,
    adjustInventory,
};
