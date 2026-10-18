import { z } from "zod";
import { slugZodSchema } from "../ecommerce.validation";

// A stored logo is a pair: `logo` is the secure URL the browser renders and
// `logoPublicId` is the provider handle used to manage/delete that asset. Half a
// pair is an incomplete reference, so both are required together.
const logoShape = {
    logo: z.string().trim().min(1).max(2000).optional(),
    logoPublicId: z.string().trim().min(1).max(500).optional(),
};

const requirePairedLogoFields = (
    data: { logo?: string; logoPublicId?: string },
    ctx: z.RefinementCtx,
) => {
    if (data.logo !== undefined && data.logoPublicId === undefined) {
        ctx.addIssue({
            code: "custom",
            message: "logoPublicId is required when logo is provided",
            path: ["logoPublicId"],
        });
    }

    if (data.logoPublicId !== undefined && data.logo === undefined) {
        ctx.addIssue({
            code: "custom",
            message: "logo must be provided together with logoPublicId",
            path: ["logo"],
        });
    }
};

export const createBrandZodSchema = z
    .object({
        name: z.string().trim().min(1, "Name is required").max(150),
        slug: slugZodSchema(180),
        description: z.string().trim().max(5000).nullish(),
        ...logoShape,
        isActive: z.boolean().optional(),
    })
    .superRefine(requirePairedLogoFields);

export const updateBrandZodSchema = z
    .object({
        name: z.string().trim().min(1).max(150).optional(),
        slug: slugZodSchema(180).optional(),
        description: z.string().trim().max(5000).nullish(),
        ...logoShape,
        isActive: z.boolean().optional(),
    })
    .superRefine(requirePairedLogoFields);

export const BrandValidation = {
    createBrandZodSchema,
    updateBrandZodSchema,
};
