import { describe, expect, it } from "vitest";
import {
    createCategoryZodSchema,
    updateCategoryZodSchema,
} from "./category.validation";

const createIssuePaths = (payload: unknown): string[] => {
    const result = createCategoryZodSchema.safeParse(payload);

    return result.success
        ? []
        : result.error.issues.map((issue) => issue.path.join("."));
};

const updateIssuePaths = (payload: unknown): string[] => {
    const result = updateCategoryZodSchema.safeParse(payload);

    return result.success
        ? []
        : result.error.issues.map((issue) => issue.path.join("."));
};

describe("createCategoryZodSchema", () => {
    it("accepts a minimal category", () => {
        const result = createCategoryZodSchema.safeParse({
            name: "SIM Cards",
            slug: "sim-cards",
        });

        expect(result.success).toBe(true);
    });

    it("requires a name", () => {
        expect(createIssuePaths({ slug: "sim-cards" })).toContain("name");
    });

    it("requires a slug", () => {
        expect(createIssuePaths({ name: "SIM Cards" })).toContain("slug");
    });

    it.each(["SIM Cards", "sim_cards", "sim/cards", "-sim-cards"])(
        "rejects the malformed slug %s",
        (slug) => {
            expect(createIssuePaths({ name: "SIM Cards", slug })).toContain(
                "slug",
            );
        },
    );

    it("accepts a complete image pair", () => {
        const result = createCategoryZodSchema.safeParse({
            name: "SIM Cards",
            slug: "sim-cards",
            image: "https://res.cloudinary.com/demo/image/upload/categories/sim.png",
            imagePublicId: "rizqifybd/categories/sim",
        });

        expect(result.success).toBe(true);
    });

    it("rejects a lone image url", () => {
        expect(
            createIssuePaths({
                name: "SIM Cards",
                slug: "sim-cards",
                image: "https://res.cloudinary.com/demo/image/upload/categories/sim.png",
            }),
        ).toContain("imagePublicId");
    });

    it("rejects a lone image public id", () => {
        expect(
            createIssuePaths({
                name: "SIM Cards",
                slug: "sim-cards",
                imagePublicId: "rizqifybd/categories/sim",
            }),
        ).toContain("image");
    });

    it("accepts an explicit null parent", () => {
        const result = createCategoryZodSchema.safeParse({
            name: "SIM Cards",
            slug: "sim-cards",
            parentId: null,
        });

        expect(result.success).toBe(true);
    });

    it("strips protected keys a client must not mass-assign", () => {
        const result = createCategoryZodSchema.safeParse({
            name: "SIM Cards",
            slug: "sim-cards",
            id: "attacker-chosen-id",
            isDeleted: true,
            deletedAt: new Date(),
            createdAt: new Date(),
        });

        expect(result.success).toBe(true);

        if (result.success) {
            expect(result.data).not.toHaveProperty("id");
            expect(result.data).not.toHaveProperty("isDeleted");
            expect(result.data).not.toHaveProperty("deletedAt");
            expect(result.data).not.toHaveProperty("createdAt");
        }
    });
});

describe("updateCategoryZodSchema", () => {
    it("accepts an empty patch", () => {
        expect(updateCategoryZodSchema.safeParse({}).success).toBe(true);
    });

    it("accepts detaching the parent with null", () => {
        const result = updateCategoryZodSchema.safeParse({ parentId: null });

        expect(result.success).toBe(true);

        if (result.success) {
            expect(result.data.parentId).toBeNull();
        }
    });

    it("still rejects a lone image url", () => {
        expect(
            updateIssuePaths({ image: "https://example.com/a.png" }),
        ).toContain("imagePublicId");
    });

    it("still rejects a malformed slug", () => {
        expect(updateIssuePaths({ slug: "Not A Slug" })).toContain("slug");
    });
});
