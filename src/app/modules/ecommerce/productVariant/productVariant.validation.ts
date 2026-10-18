import { z } from "zod";
import { moneyZodSchema } from "../ecommerce.validation";

// Free-form option dimensions (size, colour, storage, …). Only scalar JSON values
// are accepted so a client cannot smuggle a nested structure in.
const attributesZodSchema = z
    .record(z.string(), z.union([z.string().max(200), z.number(), z.boolean()]))
    .nullish();

const inventoryZodSchema = z.object({
    availableQuantity: z
        .number()
        .int("Available quantity must be a whole number")
        .nonnegative("Available quantity cannot be negative"),
    lowStockThreshold: z
        .number()
        .int("Low stock threshold must be a whole number")
        .nonnegative("Low stock threshold cannot be negative")
        .nullish(),
});

// Fields shared by create and update. `productId` is deliberately not part of it:
// a variant cannot be moved to another product.
const variantFieldShape = {
    sku: z.string().trim().min(1, "SKU is required").max(100),
    name: z.string().trim().max(200).nullish(),
    attributes: attributesZodSchema,
    price: moneyZodSchema("Price"),
    compareAtPrice: moneyZodSchema("Compare-at price").nullish(),
    isActive: z.boolean().optional(),
};

// A compare-at price is only meaningful as a "was" price: it must never be lower
// than what the customer actually pays.
const refineVariantPricing = (
    data: { price: number; compareAtPrice?: number | null },
    ctx: z.RefinementCtx,
) => {
    if (
        data.compareAtPrice !== undefined &&
        data.compareAtPrice !== null &&
        data.compareAtPrice < data.price
    ) {
        ctx.addIssue({
            code: "custom",
            message: "Compare-at price cannot be lower than the selling price",
            path: ["compareAtPrice"],
        });
    }
};

// Protected columns (id, timestamps, isDeleted/deletedAt, productId and the
// inventory relation) are intentionally absent: Zod strips unknown keys, so a
// client cannot mass-assign or move them.
export const createProductVariantZodSchema = z
    .object({
        productId: z.string().trim().min(1, "Product is required"),
        ...variantFieldShape,
        // Optional opening stock; the inventory row is always created (default 0)
        // so later stock changes have a single, atomic write path.
        inventory: inventoryZodSchema.optional(),
    })
    .superRefine(refineVariantPricing);

export const updateProductVariantZodSchema = z
    .object(variantFieldShape)
    .partial()
    .superRefine((data, ctx) => {
        // Only run the cross-field rule when both sides of the comparison are
        // present; partial updates are merged with the stored row in the service,
        // which re-runs the full create schema.
        if (data.price !== undefined && data.compareAtPrice != null) {
            refineVariantPricing(
                { price: data.price, compareAtPrice: data.compareAtPrice },
                ctx,
            );
        }
    });

export const ProductVariantValidation = {
    createProductVariantZodSchema,
    updateProductVariantZodSchema,
};
