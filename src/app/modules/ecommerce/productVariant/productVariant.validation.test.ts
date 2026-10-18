import { describe, expect, it } from "vitest";
import {
    createProductVariantZodSchema,
    updateProductVariantZodSchema,
} from "./productVariant.validation";

const createIssuePaths = (payload: unknown): string[] => {
    const result = createProductVariantZodSchema.safeParse(payload);

    return result.success
        ? []
        : result.error.issues.map((issue) => issue.path.join("."));
};

const minimalVariant = {
    productId: "p1",
    sku: "SKU-1",
    price: 199.99,
};

describe("createProductVariantZodSchema", () => {
    it("accepts a minimal variant", () => {
        expect(
            createProductVariantZodSchema.safeParse(minimalVariant).success,
        ).toBe(true);
    });

    it.each(["productId", "sku", "price"])("requires %s", (field) => {
        const payload: Record<string, unknown> = { ...minimalVariant };
        delete payload[field];

        expect(createIssuePaths(payload)).toContain(field);
    });

    it("rejects a negative price", () => {
        expect(
            createIssuePaths({ ...minimalVariant, price: -1 }),
        ).toContain("price");
    });

    it("rejects more than 2 decimal places", () => {
        expect(
            createIssuePaths({ ...minimalVariant, price: 10.999 }),
        ).toContain("price");
    });

    it("rejects an amount that cannot fit Decimal(12, 2)", () => {
        expect(
            createIssuePaths({ ...minimalVariant, price: 10_000_000_000 }),
        ).toContain("price");
    });

    it("accepts a compare-at price above the selling price", () => {
        expect(
            createProductVariantZodSchema.safeParse({
                ...minimalVariant,
                price: 100,
                compareAtPrice: 120,
            }).success,
        ).toBe(true);
    });

    it("accepts a compare-at price equal to the selling price", () => {
        expect(
            createProductVariantZodSchema.safeParse({
                ...minimalVariant,
                price: 100,
                compareAtPrice: 100,
            }).success,
        ).toBe(true);
    });

    it("rejects a compare-at price below the selling price", () => {
        expect(
            createIssuePaths({
                ...minimalVariant,
                price: 100,
                compareAtPrice: 90,
            }),
        ).toContain("compareAtPrice");
    });

    it("accepts an explicit null compare-at price", () => {
        expect(
            createProductVariantZodSchema.safeParse({
                ...minimalVariant,
                compareAtPrice: null,
            }).success,
        ).toBe(true);
    });

    it("accepts an attributes map of scalar values", () => {
        expect(
            createProductVariantZodSchema.safeParse({
                ...minimalVariant,
                attributes: { color: "black", size: 128, waterproof: true },
            }).success,
        ).toBe(true);
    });

    it("rejects a nested attributes value", () => {
        expect(
            createIssuePaths({
                ...minimalVariant,
                attributes: { nested: { a: 1 } },
            }),
        ).toContain("attributes.nested");
    });

    it("accepts an opening stock record", () => {
        expect(
            createProductVariantZodSchema.safeParse({
                ...minimalVariant,
                inventory: { availableQuantity: 10, lowStockThreshold: 3 },
            }).success,
        ).toBe(true);
    });

    it("rejects a negative opening stock", () => {
        expect(
            createIssuePaths({
                ...minimalVariant,
                inventory: { availableQuantity: -1 },
            }),
        ).toContain("inventory.availableQuantity");
    });

    it("rejects a fractional opening stock", () => {
        expect(
            createIssuePaths({
                ...minimalVariant,
                inventory: { availableQuantity: 1.5 },
            }),
        ).toContain("inventory.availableQuantity");
    });

    it("strips protected keys", () => {
        const result = createProductVariantZodSchema.safeParse({
            ...minimalVariant,
            isDeleted: true,
            deletedAt: new Date(),
        });

        expect(result.success).toBe(true);

        if (result.success) {
            expect(result.data).not.toHaveProperty("isDeleted");
            expect(result.data).not.toHaveProperty("deletedAt");
        }
    });
});

describe("updateProductVariantZodSchema", () => {
    it("accepts an empty patch", () => {
        expect(updateProductVariantZodSchema.safeParse({}).success).toBe(true);
    });

    it("strips productId so a variant cannot be moved between products", () => {
        const result = updateProductVariantZodSchema.safeParse({
            productId: "other-product",
            name: "Renamed",
        });

        expect(result.success).toBe(true);

        if (result.success) {
            expect(result.data).not.toHaveProperty("productId");
            expect(result.data.name).toBe("Renamed");
        }
    });

    it("strips inventory so stock only changes through the inventory endpoints", () => {
        const result = updateProductVariantZodSchema.safeParse({
            inventory: { availableQuantity: 999 },
        });

        expect(result.success).toBe(true);
        expect(result.success ? result.data : {}).not.toHaveProperty(
            "inventory",
        );
    });

    it("rejects a partial patch that already breaks the pricing rule", () => {
        const result = updateProductVariantZodSchema.safeParse({
            price: 100,
            compareAtPrice: 90,
        });

        expect(result.success).toBe(false);
    });
});
