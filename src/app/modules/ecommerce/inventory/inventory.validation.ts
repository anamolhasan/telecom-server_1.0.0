import { z } from "zod";

// Sanity ceiling for a single stock value. The column is an Int, so the only hard
// limit is the PostgreSQL int range; this bound keeps obvious client mistakes and
// absurd payloads out while leaving room for real inventory.
const MAX_STOCK_QUANTITY = 1_000_000;

const quantityZodSchema = (noun: string) =>
    z
        .number()
        .int(`${noun} must be a whole number`)
        .nonnegative(`${noun} cannot be negative`)
        .max(MAX_STOCK_QUANTITY, `${noun} is too large`);

// PUT semantics: the whole inventory record is replaced, so an omitted threshold
// deliberately clears it.
export const setInventoryZodSchema = z.object({
    availableQuantity: quantityZodSchema("Available quantity"),
    lowStockThreshold: quantityZodSchema("Low stock threshold").nullish(),
});

export const adjustInventoryZodSchema = z.object({
    delta: z
        .number()
        .int("Adjustment must be a whole number")
        .refine((value) => value !== 0, "Adjustment must not be zero")
        .refine(
            (value) => Math.abs(value) <= MAX_STOCK_QUANTITY,
            "Adjustment is too large",
        ),
});

export const InventoryValidation = {
    setInventoryZodSchema,
    adjustInventoryZodSchema,
};
