import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProductStatus, Role } from "../../../../generated/prisma/enums";
import { ProductVariantService } from "./productVariant.service";

// The service only talks to Prisma, which is mocked here.
const mocks = vi.hoisted(() => ({
    variantFindFirst: vi.fn(),
    variantFindMany: vi.fn(),
    variantCount: vi.fn(),
    variantCreate: vi.fn(),
    variantUpdate: vi.fn(),
    productFindFirst: vi.fn(),
}));

vi.mock("../../../lib/prisma", () => ({
    prisma: {
        productVariant: {
            findFirst: mocks.variantFindFirst,
            findMany: mocks.variantFindMany,
            count: mocks.variantCount,
            create: mocks.variantCreate,
            update: mocks.variantUpdate,
        },
        product: { findFirst: mocks.productFindFirst },
    },
}));

const storedVariant = (overrides: Record<string, unknown> = {}) => ({
    id: "v1",
    productId: "p1",
    sku: "SKU-1",
    name: "Standard",
    attributes: { color: "black" },
    price: 100,
    compareAtPrice: null,
    isActive: true,
    isDeleted: false,
    deletedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    inventory: { availableQuantity: 5, lowStockThreshold: null },
    product: {
        id: "p1",
        name: "Smartphone",
        slug: "smartphone",
        status: ProductStatus.ACTIVE,
        isActive: true,
        isDeleted: false,
    },
    ...overrides,
});

beforeEach(() => {
    vi.resetAllMocks();
    mocks.productFindFirst.mockResolvedValue({ id: "p1" });
});

describe("ProductVariantService.createProductVariant", () => {
    it("rejects an unknown product", async () => {
        mocks.productFindFirst.mockResolvedValue(null);

        await expect(
            ProductVariantService.createProductVariant({
                productId: "missing",
                sku: "SKU-1",
                price: 10,
            }),
        ).rejects.toMatchObject({ statusCode: 404 });

        expect(mocks.variantCreate).not.toHaveBeenCalled();
    });

    it("creates the single inventory row with a default opening stock of zero", async () => {
        mocks.variantCreate.mockResolvedValue(storedVariant());

        await ProductVariantService.createProductVariant({
            productId: "p1",
            sku: "SKU-1",
            price: 10,
        });

        expect(mocks.variantCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    productId: "p1",
                    sku: "SKU-1",
                    price: 10,
                    compareAtPrice: null,
                    isActive: true,
                    inventory: {
                        create: {
                            availableQuantity: 0,
                            lowStockThreshold: null,
                        },
                    },
                }),
            }),
        );
    });

    it("uses the requested opening stock when one is supplied", async () => {
        mocks.variantCreate.mockResolvedValue(storedVariant());

        await ProductVariantService.createProductVariant({
            productId: "p1",
            sku: "SKU-1",
            price: 10,
            inventory: { availableQuantity: 7, lowStockThreshold: 3 },
        });

        expect(mocks.variantCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    inventory: {
                        create: {
                            availableQuantity: 7,
                            lowStockThreshold: 3,
                        },
                    },
                }),
            }),
        );
    });

    it("serializes Decimal money back to numbers", async () => {
        mocks.variantCreate.mockResolvedValue(
            storedVariant({
                price: { toNumber: () => 12.5 },
                compareAtPrice: { toNumber: () => 15 },
            }),
        );

        const view = await ProductVariantService.createProductVariant({
            productId: "p1",
            sku: "SKU-1",
            price: 12.5,
            compareAtPrice: 15,
        });

        expect(view.price).toBe(12.5);
        expect(view.compareAtPrice).toBe(15);
    });
});

describe("ProductVariantService.getProductVariantById visibility", () => {
    it("applies the published-product filter for a public caller", async () => {
        mocks.variantFindFirst.mockResolvedValue(storedVariant());

        await ProductVariantService.getProductVariantById("v1", undefined);

        expect(mocks.variantFindFirst).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    id: "v1",
                    isDeleted: false,
                    product: {
                        isDeleted: false,
                        isActive: true,
                        status: ProductStatus.ACTIVE,
                    },
                },
            }),
        );
    });

    it("does not filter by product state for a content admin", async () => {
        mocks.variantFindFirst.mockResolvedValue(
            storedVariant({ isActive: false }),
        );

        await ProductVariantService.getProductVariantById("v1", Role.ADMIN);

        expect(mocks.variantFindFirst).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: "v1", isDeleted: false },
            }),
        );
    });

    it("reports an unpublished variant as missing to a public caller", async () => {
        mocks.variantFindFirst.mockResolvedValue(
            storedVariant({ isActive: false }),
        );

        await expect(
            ProductVariantService.getProductVariantById("v1", Role.USER),
        ).rejects.toMatchObject({ statusCode: 404 });
    });

    it("reports a variant of an unpublished product as missing", async () => {
        mocks.variantFindFirst.mockResolvedValue(null);

        await expect(
            ProductVariantService.getProductVariantById("v1", undefined),
        ).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe("ProductVariantService.updateProductVariant", () => {
    it("merges the patch over the stored row and re-validates the result", async () => {
        mocks.variantFindFirst.mockResolvedValue(
            storedVariant({ price: 100, compareAtPrice: 120 }),
        );

        // The patch alone passes validation, but the merged state (compare-at
        // 120 < new price 150) must not.
        await expect(
            ProductVariantService.updateProductVariant("v1", { price: 150 }),
        ).rejects.toMatchObject({ statusCode: 400 });

        expect(mocks.variantUpdate).not.toHaveBeenCalled();
    });

    it("saves a valid merged state", async () => {
        mocks.variantFindFirst.mockResolvedValue(
            storedVariant({ price: 100, compareAtPrice: 120 }),
        );
        mocks.variantUpdate.mockResolvedValue(
            storedVariant({ price: 90, compareAtPrice: null }),
        );

        const view = await ProductVariantService.updateProductVariant("v1", {
            price: 90,
            compareAtPrice: null,
        });

        expect(mocks.variantUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: "v1" },
                data: expect.objectContaining({
                    price: 90,
                    compareAtPrice: null,
                    isActive: true,
                }),
            }),
        );
        expect(view.price).toBe(90);
    });

    it("rejects an unknown variant", async () => {
        mocks.variantFindFirst.mockResolvedValue(null);

        await expect(
            ProductVariantService.updateProductVariant("v1", { price: 5 }),
        ).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe("ProductVariantService.deleteProductVariant", () => {
    it("soft deletes and deactivates the variant", async () => {
        mocks.variantFindFirst.mockResolvedValue({ id: "v1" });
        mocks.variantUpdate.mockResolvedValue(
            storedVariant({ isDeleted: true, isActive: false }),
        );

        await ProductVariantService.deleteProductVariant("v1");

        expect(mocks.variantUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: "v1" },
                data: expect.objectContaining({
                    isDeleted: true,
                    isActive: false,
                }),
            }),
        );
    });

    it("rejects an unknown variant", async () => {
        mocks.variantFindFirst.mockResolvedValue(null);

        await expect(
            ProductVariantService.deleteProductVariant("v1"),
        ).rejects.toMatchObject({ statusCode: 404 });

        expect(mocks.variantUpdate).not.toHaveBeenCalled();
    });
});

describe("ProductVariantService.getAllProductVariants visibility", () => {
    const findManyArgs = (): { where: Record<string, unknown> } =>
        mocks.variantFindMany.mock.calls[0]?.[0] as {
            where: Record<string, unknown>;
        };

    const countArgs = (): { where: Record<string, unknown> } =>
        mocks.variantCount.mock.calls[0]?.[0] as {
            where: Record<string, unknown>;
        };

    beforeEach(() => {
        mocks.variantFindMany.mockResolvedValue([]);
        mocks.variantCount.mockResolvedValue(0);
    });

    it("hides variants of unpublished products from a public list", async () => {
        await ProductVariantService.getAllProductVariants(
            { productId: "p1", isActive: "false", isDeleted: "true" },
            undefined,
        );

        // The variant's own flags AND its parent product's publication state are
        // forced, so drafting a product hides every SKU at once.
        expect(findManyArgs().where).toMatchObject({
            isDeleted: false,
            isActive: true,
            product: {
                isDeleted: false,
                isActive: true,
                status: ProductStatus.ACTIVE,
            },
        });
        expect(countArgs().where).toMatchObject({
            isDeleted: false,
            isActive: true,
            product: {
                isDeleted: false,
                isActive: true,
                status: ProductStatus.ACTIVE,
            },
        });
    });

    it("lets a content admin list archived variants", async () => {
        await ProductVariantService.getAllProductVariants(
            { isActive: "false" },
            Role.ADMIN,
        );

        expect(findManyArgs().where).toMatchObject({ isActive: false });
    });
});
