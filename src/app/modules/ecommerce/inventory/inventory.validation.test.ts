import { describe, expect, it } from "vitest";
import {
    adjustInventoryZodSchema,
    setInventoryZodSchema,
} from "./inventory.validation";

const setIssuePaths = (payload: unknown): string[] => {
    const result = setInventoryZodSchema.safeParse(payload);

    return result.success
        ? []
        : result.error.issues.map((issue) => issue.path.join("."));
};

const adjustIssuePaths = (payload: unknown): string[] => {
    const result = adjustInventoryZodSchema.safeParse(payload);

    return result.success
        ? []
        : result.error.issues.map((issue) => issue.path.join("."));
};

describe("setInventoryZodSchema", () => {
    it("accepts a whole, non-negative quantity", () => {
        expect(
            setInventoryZodSchema.safeParse({ availableQuantity: 12 }).success,
        ).toBe(true);
    });

    it("accepts zero", () => {
        const result = setInventoryZodSchema.safeParse({
            availableQuantity: 0,
        });

        expect(result.success).toBe(true);

        if (result.success) {
            expect(result.data.availableQuantity).toBe(0);
        }
    });

    it.each([-1, -0.5])("rejects the negative quantity %s", (quantity) => {
        expect(
            setIssuePaths({ availableQuantity: quantity }),
        ).toContain("availableQuantity");
    });

    it("rejects a fractional quantity", () => {
        expect(setIssuePaths({ availableQuantity: 1.5 })).toContain(
            "availableQuantity",
        );
    });

    it("rejects a non-numeric quantity", () => {
        expect(setIssuePaths({ availableQuantity: "10" })).toContain(
            "availableQuantity",
        );
    });

    it("requires a quantity", () => {
        expect(setIssuePaths({})).toContain("availableQuantity");
    });

    it("accepts a null threshold", () => {
        expect(
            setInventoryZodSchema.safeParse({
                availableQuantity: 5,
                lowStockThreshold: null,
            }).success,
        ).toBe(true);
    });

    it("rejects a negative threshold", () => {
        expect(
            setIssuePaths({ availableQuantity: 5, lowStockThreshold: -2 }),
        ).toContain("lowStockThreshold");
    });

    it("strips protected keys", () => {
        const result = setInventoryZodSchema.safeParse({
            availableQuantity: 5,
            variantId: "forced",
            updatedAt: new Date(),
        });

        expect(result.success).toBe(true);

        if (result.success) {
            expect(result.data).not.toHaveProperty("variantId");
            expect(result.data).not.toHaveProperty("updatedAt");
        }
    });
});

describe("adjustInventoryZodSchema", () => {
    it("accepts a positive adjustment", () => {
        expect(adjustInventoryZodSchema.safeParse({ delta: 5 }).success).toBe(
            true,
        );
    });

    it("accepts a negative adjustment", () => {
        expect(adjustInventoryZodSchema.safeParse({ delta: -5 }).success).toBe(
            true,
        );
    });

    it("rejects a zero adjustment", () => {
        expect(adjustIssuePaths({ delta: 0 })).toContain("delta");
    });

    it("rejects a fractional adjustment", () => {
        expect(adjustIssuePaths({ delta: 1.5 })).toContain("delta");
    });

    it("requires an adjustment", () => {
        expect(adjustIssuePaths({})).toContain("delta");
    });
});
