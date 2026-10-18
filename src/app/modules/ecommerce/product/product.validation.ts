import { z } from "zod";
import { ProductStatus } from "../../../../generated/prisma/enums";
import { slugZodSchema } from "../ecommerce.validation";

// Product gallery entries. Unlike the single-image pair on Category/Brand, a
// gallery image may legitimately have no provider handle (an externally hosted
// URL), so `publicId` stays optional.
const productImageZodSchema = z.object({
    url: z.string().trim().min(1, "Image url is required").max(2000),
    publicId: z.string().trim().min(1).max(500).nullish(),
    altText: z.string().trim().max(200).nullish(),
    position: z.number().int().nonnegative().optional(),
});

const productFieldShape = {
    name: z.string().trim().min(1, "Name is required").max(200),
    slug: slugZodSchema(220),
    description: z.string().trim().min(1, "Description is required").max(20000),
    categoryId: z.string().trim().min(1, "Category is required"),
    brandId: z.string().trim().min(1).nullish(),
    status: z.nativeEnum(ProductStatus).optional(),
    isActive: z.boolean().optional(),
};

// Protected columns (id, timestamps, isDeleted/deletedAt) are intentionally
// absent: Zod strips unknown keys, so a client cannot mass-assign them.
export const createProductZodSchema = z.object({
    ...productFieldShape,
    images: z.array(productImageZodSchema).max(20).optional(),
});

export const updateProductZodSchema = z
    .object({
        ...productFieldShape,
        images: z.array(productImageZodSchema).max(20).optional(),
    })
    .partial();

export const ProductValidation = {
    createProductZodSchema,
    updateProductZodSchema,
};
