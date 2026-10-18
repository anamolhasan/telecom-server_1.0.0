import { beforeEach, describe, expect, it, vi } from "vitest";
import { InventoryService } from "./inventory.service";

// The service only talks to Prisma, which is mocked here.
const mocks = vi.hoisted(() => ({
    inventoryFindUnique: vi.fn(),
    inventoryFindUniqueOrThrow: vi.fn(),
    inventoryUpsert: vi.fn(),
    inventoryUpdateMany: vi.fn(),
    inventoryUpdate: vi.fn(),
    variantFindFirst: vi.fn(),
}));

vi.mock("../../../lib/prisma", () => ({
    prisma: {
        inventory: {
            findUnique: mocks.inventoryFindUnique,
            findUniqueOrThrow: mocks.inventoryFindUniqueOrThrow,
            upsert: mocks.inventoryUpsert,
            updateMany: mocks.inventoryUpdateMany,
            update: mocks.inventoryUpdate,
        },
        productVariant: { findFirst: mocks.variantFindFirst },
    },
}));

beforeEach(() => {
    vi.resetAllMocks();
});

describe("InventoryService.getInventoryByVariantId", () => {
    it("reports a missing inventory record", async () => {
        mocks.inventoryFindUnique.mockResolvedValue(null);

        await expect(
            InventoryService.getInventoryByVariantId("v1"),
        ).rejects.toMatchObject({ statusCode: 404 });
    });

    it("returns the record for the variant", async () => {
        mocks.inventoryFindUnique.mockResolvedValue({
            variantId: "v1",
            availableQuantity: 4,
            lowStockThreshold: null,
        });

        await expect(
            InventoryService.getInventoryByVariantId("v1"),
        ).resolves.toMatchObject({ variantId: "v1", availableQuantity: 4 });
    });
});

describe("InventoryService.setInventory", () => {
    it("refuses to touch inventory for an unknown variant", async () => {
        mocks.variantFindFirst.mockResolvedValue(null);

        await expect(
            InventoryService.setInventory("v1", { availableQuantity: 5 }),
        ).rejects.toMatchObject({ statusCode: 404 });

        expect(mocks.inventoryUpsert).not.toHaveBeenCalled();
    });

    it("writes the exact validated quantity", async () => {
        mocks.variantFindFirst.mockResolvedValue({ id: "v1" });
        mocks.inventoryUpsert.mockResolvedValue({
            variantId: "v1",
            availableQuantity: 5,
        });

        await InventoryService.setInventory("v1", {
            availableQuantity: 5,
            lowStockThreshold: 2,
        });

        expect(mocks.inventoryUpsert).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { variantId: "v1" },
                create: {
                    variantId: "v1",
                    availableQuantity: 5,
                    lowStockThreshold: 2,
                },
                update: {
                    availableQuantity: 5,
                    lowStockThreshold: 2,
                },
            }),
        );
    });

    it("clears the threshold when the PUT omits it", async () => {
        mocks.variantFindFirst.mockResolvedValue({ id: "v1" });
        mocks.inventoryUpsert.mockResolvedValue({ variantId: "v1" });

        await InventoryService.setInventory("v1", { availableQuantity: 0 });

        expect(mocks.inventoryUpsert).toHaveBeenCalledWith(
            expect.objectContaining({
                update: { availableQuantity: 0, lowStockThreshold: null },
            }),
        );
    });
});

describe("InventoryService.adjustInventory", () => {
    it("refuses to adjust a variant with no inventory record", async () => {
        mocks.inventoryFindUnique.mockResolvedValue(null);

        await expect(
            InventoryService.adjustInventory("v1", { delta: -1 }),
        ).rejects.toMatchObject({ statusCode: 404 });

        expect(mocks.inventoryUpdateMany).not.toHaveBeenCalled();
    });

    it("decrements through a single guarded conditional update", async () => {
        mocks.inventoryFindUnique.mockResolvedValue({ variantId: "v1" });
        mocks.inventoryUpdateMany.mockResolvedValue({ count: 1 });
        mocks.inventoryFindUniqueOrThrow.mockResolvedValue({
            variantId: "v1",
            availableQuantity: 2,
        });

        await InventoryService.adjustInventory("v1", { delta: -3 });

        // The floor check and the decrement are the same statement, so two
        // concurrent decrements cannot both pass and drive stock negative.
        expect(mocks.inventoryUpdateMany).toHaveBeenCalledWith({
            where: { variantId: "v1", availableQuantity: { gte: 3 } },
            data: { availableQuantity: { increment: -3 } },
        });
        expect(mocks.inventoryUpdate).not.toHaveBeenCalled();
    });

    it("reports a conflict instead of overselling when stock is insufficient", async () => {
        mocks.inventoryFindUnique.mockResolvedValue({ variantId: "v1" });
        mocks.inventoryUpdateMany.mockResolvedValue({ count: 0 });

        await expect(
            InventoryService.adjustInventory("v1", { delta: -5 }),
        ).rejects.toMatchObject({ statusCode: 409 });

        expect(mocks.inventoryFindUniqueOrThrow).not.toHaveBeenCalled();
    });

    it("increments a restock", async () => {
        mocks.inventoryFindUnique.mockResolvedValue({ variantId: "v1" });
        mocks.inventoryUpdate.mockResolvedValue({
            variantId: "v1",
            availableQuantity: 15,
        });
        mocks.inventoryFindUniqueOrThrow.mockResolvedValue({
            variantId: "v1",
            availableQuantity: 15,
        });

        await InventoryService.adjustInventory("v1", { delta: 10 });

        expect(mocks.inventoryUpdate).toHaveBeenCalledWith({
            where: { variantId: "v1" },
            data: { availableQuantity: { increment: 10 } },
        });
        expect(mocks.inventoryUpdateMany).not.toHaveBeenCalled();
    });
});
