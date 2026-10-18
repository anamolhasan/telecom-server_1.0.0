import { describe, expect, it } from "vitest";
import { ProductStatus } from "../../../../generated/prisma/enums";
import {
    createProductZodSchema,
    updateProductZodSchema,
} from "./product.validation";

const createIssuePaths = (payload: unknown): string[] => {
    const result = createProductZodSchema.safeParse(payload);

    return result.success
        ? []
        : result.error.issues.map((issue) => issue.path.join("."));
};

const minimalProduct = {
    name: "Smartphone",
    slug: "smartphone",
    description: "A phone",
    categoryId: "cat1",
};

describe("createProductZodSchema", () => {
    it("accepts a minimal product", () => {
        expect(createProductZodSchema.safeParse(minimalProduct).success).toBe(
            true,
        );
    });

    it.each(["name", "slug", "description", "categoryId"])(
        "requires %s",
        (field) => {
            const payload: Record<string, unknown> = { ...minimalProduct };
            delete payload[field];

            expect(createIssuePaths(payload)).toContain(field);
        },
    );

    it("rejects a malformed slug", () => {
        expect(
            createIssuePaths({ ...minimalProduct, slug: "Smart Phone" }),
        ).toContain("slug");
    });

    it("rejects an unknown status", () => {
        expect(
            createIssuePaths({ ...minimalProduct, status: "PUBLISHED" }),
        ).toContain("status");
    });

    it("accepts a known status", () => {
        const result = createProductZodSchema.safeParse({
            ...minimalProduct,
            status: ProductStatus.ACTIVE,
        });

        expect(result.success).toBe(true);

        if (result.success) {
            expect(result.data.status).toBe(ProductStatus.ACTIVE);
        }
    });

    it("requires a url for every gallery image", () => {
        expect(
            createIssuePaths({ ...minimalProduct, images: [{ altText: "x" }] }),
        ).toContain("images.0.url");
    });

    it("accepts gallery images without a provider handle", () => {
        expect(
            createProductZodSchema.safeParse({
                ...minimalProduct,
                images: [{ url: "https://example.com/a.png" }],
            }).success,
        ).toBe(true);
    });

    it("rejects a negative gallery position", () => {
        expect(
            createIssuePaths({
                ...minimalProduct,
                images: [{ url: "https://example.com/a.png", position: -1 }],
            }),
        ).toContain("images.0.position");
    });

    it("caps the gallery at 20 images", () => {
        const images = Array.from({ length: 21 }, (_, index) => ({
            url: `https://example.com/${index}.png`,
        }));

        expect(createIssuePaths({ ...minimalProduct, images })).toContain(
            "images",
        );
    });

    it("strips protected keys", () => {
        const result = createProductZodSchema.safeParse({
            ...minimalProduct,
            isDeleted: true,
            variants: [{ sku: "forced" }],
        });

        expect(result.success).toBe(true);

        if (result.success) {
            expect(result.data).not.toHaveProperty("isDeleted");
            expect(result.data).not.toHaveProperty("variants");
        }
    });
});

describe("updateProductZodSchema", () => {
    it("accepts an empty patch", () => {
        expect(updateProductZodSchema.safeParse({}).success).toBe(true);
    });

    it("accepts detaching the brand with null", () => {
        const result = updateProductZodSchema.safeParse({ brandId: null });

        expect(result.success).toBe(true);

        if (result.success) {
            expect(result.data.brandId).toBeNull();
        }
    });

    it("accepts clearing the gallery with an empty array", () => {
        const result = updateProductZodSchema.safeParse({ images: [] });

        expect(result.success).toBe(true);

        if (result.success) {
            expect(result.data.images).toEqual([]);
        }
    });

    it("still rejects an unknown status", () => {
        const result = updateProductZodSchema.safeParse({ status: "NOPE" });

        expect(result.success).toBe(false);
    });

    it("strips protected keys", () => {
        const result = updateProductZodSchema.safeParse({
            name: "Renamed",
            deletedAt: new Date(),
            isDeleted: true,
        });

        expect(result.success).toBe(true);

        if (result.success) {
            expect(result.data).not.toHaveProperty("deletedAt");
            expect(result.data).not.toHaveProperty("isDeleted");
        }
    });
});
