import { z } from "zod";

// A link may be product-bound (productId set) or a campaign link (productId
// omitted, and supplied per visit). Nothing else is client-settable: the code, the
// owner and the click counter are all server-controlled.
export const createAffiliateLinkZodSchema = z.object({
    productId: z.string().trim().min(1).optional().nullable(),
    label: z.string().trim().max(150).optional().nullable(),
});

export const updateAffiliateLinkZodSchema = z
    .object({
        label: z.string().trim().max(150).optional().nullable(),
        isActive: z.boolean().optional(),
    })
    .refine(
        (value) => value.label !== undefined || value.isActive !== undefined,
        { message: "At least one field must be provided" },
    );

// The link code itself is the only input the visitor controls; the product comes
// from the link or from the visited product page.
export const trackAffiliateVisitZodSchema = z.object({
    code: z.string().trim().min(1, "Affiliate link code is required").max(64),
    productId: z.string().trim().min(1).optional().nullable(),
});

export const AffiliateValidation = {
    createAffiliateLinkZodSchema,
    updateAffiliateLinkZodSchema,
    trackAffiliateVisitZodSchema,
};
