import { z } from "zod";
import { slugZodSchema } from "../ecommerce.validation";

// A stored image is a pair: `image` is the secure URL the browser renders and
// `imagePublicId` is the provider handle used to manage/delete that asset. Half a
// pair is an incomplete reference — a URL that can never be cleaned up, or an
// orphaned handle pointing at nothing we can identify.
const imageShape = {
    image: z.string().trim().min(1).max(2000).optional(),
    imagePublicId: z.string().trim().min(1).max(500).optional(),
};

const requirePairedImageFields = (
    data: { image?: string; imagePublicId?: string },
    ctx: z.RefinementCtx,
) => {
    if (data.image !== undefined && data.imagePublicId === undefined) {
        ctx.addIssue({
            code: "custom",
            message: "imagePublicId is required when image is provided",
            path: ["imagePublicId"],
        });
    }

    if (data.imagePublicId !== undefined && data.image === undefined) {
        ctx.addIssue({
            code: "custom",
            message: "image must be provided together with imagePublicId",
            path: ["image"],
        });
    }
};

export const createCategoryZodSchema = z
    .object({
        name: z.string().trim().min(1, "Name is required").max(150),
        slug: slugZodSchema(180),
        description: z.string().trim().max(5000).nullish(),
        ...imageShape,
        parentId: z.string().trim().min(1).nullish(),
        isActive: z.boolean().optional(),
    })
    .superRefine(requirePairedImageFields);

export const updateCategoryZodSchema = z
    .object({
        name: z.string().trim().min(1).max(150).optional(),
        slug: slugZodSchema(180).optional(),
        description: z.string().trim().max(5000).nullish(),
        ...imageShape,
        parentId: z.string().trim().min(1).nullish(),
        isActive: z.boolean().optional(),
    })
    .superRefine(requirePairedImageFields);

export const CategoryValidation = {
    createCategoryZodSchema,
    updateCategoryZodSchema,
};
