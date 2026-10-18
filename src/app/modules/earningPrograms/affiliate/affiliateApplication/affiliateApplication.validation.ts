import { z } from "zod";
import { AffiliateApplicationStatus } from "../../../../../generated/prisma/enums";

export const submitAffiliateApplicationZodSchema = z.object({
    reason: z
        .string()
        .trim()
        .min(1, "Reason cannot be empty")
        .max(2000, "Reason is too long")
        .optional(),
});

export const reviewAffiliateApplicationZodSchema = z.object({
    status: z.nativeEnum(AffiliateApplicationStatus),
    rejectionReason: z.string().trim().min(1, "Rejection reason is required").optional(),
});

export const AffiliateApplicationValidation = {
    submitAffiliateApplicationZodSchema,
    reviewAffiliateApplicationZodSchema,
};
