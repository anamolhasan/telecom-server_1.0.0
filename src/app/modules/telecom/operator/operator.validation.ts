import { z } from "zod";

// A stored logo is a pair: `logo` is the secure URL the browser renders and
// `logoPublicId` is the provider handle used to manage that asset. Half a pair
// is an incomplete reference - a URL we can never clean up, or an orphaned
// handle pointing at nothing we can identify.
const logoShape = {
    logo: z.string().trim().min(1).optional(),
    logoPublicId: z.string().trim().min(1).optional(),
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

export const createOperatorZodSchema = z
    .object({
        name: z.string().min(1, "Name is required").max(100),
        code: z.string().min(1, "Code is required").max(20),
        ...logoShape,
        isActive: z.boolean().optional(),
    })
    .superRefine(requirePairedLogoFields);

export const updateOperatorZodSchema = z
    .object({
        name: z.string().min(1).max(100).optional(),
        code: z.string().min(1).max(20).optional(),
        ...logoShape,
        isActive: z.boolean().optional(),
    })
    .superRefine((data, ctx) => {
        // Only the public id is rejected here. A lone `logo` stays legal so
        // legacy rows (logo set, logoPublicId null) can be re-sent unchanged;
        // the service compares against the stored row and rejects a lone logo
        // only when it would actually replace the existing one.
        if (data.logoPublicId !== undefined && data.logo === undefined) {
            ctx.addIssue({
                code: "custom",
                message: "logo must be provided together with logoPublicId",
                path: ["logo"],
            });
        }
    });

export const OperatorValidation = {
    createOperatorZodSchema,
    updateOperatorZodSchema,
};
