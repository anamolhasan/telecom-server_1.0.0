import { z } from "zod";

// Decimal(12, 2): 12 significant digits with 2 decimal places (paisa).
export const MAX_MONEY = 9_999_999_999.99;

// Slugs are part of the public API surface, so the shape is enforced at the
// boundary instead of being trusted from the client.
export const slugZodSchema = (maxLength: number) =>
    z
        .string()
        .trim()
        .min(1, "Slug is required")
        .max(maxLength)
        .regex(
            /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
            "Slug must be lowercase letters, numbers and hyphens only",
        );

// Money columns are Decimal(12, 2): non-negative, bounded and never carrying more
// precision than the column can store (otherwise Prisma would silently round or
// fail with an opaque error).
export const moneyZodSchema = (noun: string) =>
    z
        .number()
        .finite(`${noun} must be a number`)
        .nonnegative(`${noun} cannot be negative`)
        .max(MAX_MONEY, `${noun} is too large`)
        .refine(
            (value) => Math.abs(Math.round(value * 100) - value * 100) < 1e-6,
            `${noun} cannot have more than 2 decimal places`,
        );
