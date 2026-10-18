import { describe, expect, it } from "vitest";
import {
    addCartItemZodSchema,
    MAX_CART_ITEM_QUANTITY,
    updateCartItemZodSchema,
} from "./cart.validation";

const addIssuePaths = (payload: unknown): string[] => {
    const result = addCartItemZodSchema.safeParse(payload);

    return result.success
        ? []
        : result.error.issues.map((issue) => issue.path.join("."));
};

const updateIssuePaths = (payload: unknown): string[] => {
    const result = updateCartItemZodSchema.safeParse(payload);

    return result.success
        ? []
        : result.error.issues.map((issue) => issue.path.join("."));
};

describe("addCartItemZodSchema", () => {
    it("requires a variant", () => {
        expect(addIssuePaths({})).toContain("variantId");
    });

    it("defaults to one unit", () => {
        const result = addCartItemZodSchema.safeParse({ variantId: "v1" });

        expect(result.success).toBe(true);

        if (result.success) {
            expect(result.data.quantity).toBe(1);
        }
    });

    it.each([0, -1, 1.5, MAX_CART_ITEM_QUANTITY + 1])(
        "rejects the quantity %s",
        (quantity) => {
            expect(addIssuePaths({ variantId: "v1", quantity })).toContain(
                "quantity",
            );
        },
    );

    it("accepts the maximum quantity", () => {
        expect(
            addCartItemZodSchema.safeParse({
                variantId: "v1",
                quantity: MAX_CART_ITEM_QUANTITY,
            }).success,
        ).toBe(true);
    });

    it("strips a client-supplied cart id", () => {
        const result = addCartItemZodSchema.safeParse({
            variantId: "v1",
            cartId: "someone-elses-cart",
        });

        expect(result.success).toBe(true);

        if (result.success) {
            expect(result.data).not.toHaveProperty("cartId");
        }
    });

    it("strips a client-supplied unit price", () => {
        const result = addCartItemZodSchema.safeParse({
            variantId: "v1",
            price: 0.01,
        });

        expect(result.success).toBe(true);

        if (result.success) {
            expect(result.data).not.toHaveProperty("price");
        }
    });
});

describe("updateCartItemZodSchema", () => {
    it("requires a quantity", () => {
        expect(updateIssuePaths({})).toContain("quantity");
    });

    it("rejects zero so removal stays an explicit DELETE", () => {
        expect(updateIssuePaths({ quantity: 0 })).toContain("quantity");
    });

    it("accepts a quantity within range", () => {
        expect(updateCartItemZodSchema.safeParse({ quantity: 3 }).success).toBe(
            true,
        );
    });
});
