import { describe, expect, it } from "vitest";
import {
    createBrandZodSchema,
    updateBrandZodSchema,
} from "./brand.validation";

const createIssuePaths = (payload: unknown): string[] => {
    const result = createBrandZodSchema.safeParse(payload);

    return result.success
        ? []
        : result.error.issues.map((issue) => issue.path.join("."));
};

const updateIssuePaths = (payload: unknown): string[] => {
    const result = updateBrandZodSchema.safeParse(payload);

    return result.success
        ? []
        : result.error.issues.map((issue) => issue.path.join("."));
};

describe("createBrandZodSchema", () => {
    it("accepts a minimal brand", () => {
        expect(
            createBrandZodSchema.safeParse({ name: "Samsung", slug: "samsung" })
                .success,
        ).toBe(true);
    });

    it("requires a name and a slug", () => {
        expect(createIssuePaths({ slug: "samsung" })).toContain("name");
        expect(createIssuePaths({ name: "Samsung" })).toContain("slug");
    });

    it("rejects a malformed slug", () => {
        expect(
            createIssuePaths({ name: "Samsung", slug: "Samsung Phones" }),
        ).toContain("slug");
    });

    it("accepts a complete logo pair", () => {
        expect(
            createBrandZodSchema.safeParse({
                name: "Samsung",
                slug: "samsung",
                logo: "https://res.cloudinary.com/demo/image/upload/brands/samsung.png",
                logoPublicId: "rizqifybd/brands/samsung",
            }).success,
        ).toBe(true);
    });

    it("rejects a lone logo url", () => {
        expect(
            createIssuePaths({
                name: "Samsung",
                slug: "samsung",
                logo: "https://res.cloudinary.com/demo/image/upload/brands/samsung.png",
            }),
        ).toContain("logoPublicId");
    });

    it("rejects a lone logo public id", () => {
        expect(
            createIssuePaths({
                name: "Samsung",
                slug: "samsung",
                logoPublicId: "rizqifybd/brands/samsung",
            }),
        ).toContain("logo");
    });

    it("strips protected keys", () => {
        const result = createBrandZodSchema.safeParse({
            name: "Samsung",
            slug: "samsung",
            isDeleted: true,
            id: "forced",
        });

        expect(result.success).toBe(true);

        if (result.success) {
            expect(result.data).not.toHaveProperty("isDeleted");
            expect(result.data).not.toHaveProperty("id");
        }
    });
});

describe("updateBrandZodSchema", () => {
    it("accepts an empty patch", () => {
        expect(updateBrandZodSchema.safeParse({}).success).toBe(true);
    });

    it("still enforces the logo pairing", () => {
        expect(
            updateIssuePaths({ logoPublicId: "rizqifybd/brands/samsung" }),
        ).toContain("logo");
    });

    it("accepts a complete logo pair", () => {
        expect(
            updateBrandZodSchema.safeParse({
                logo: "https://res.cloudinary.com/demo/image/upload/brands/samsung.png",
                logoPublicId: "rizqifybd/brands/samsung",
            }).success,
        ).toBe(true);
    });
});
