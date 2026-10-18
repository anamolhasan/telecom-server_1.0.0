import { z } from "zod";
import {
    ReferralApplicationStatus,
    ReferralPromotionMethod,
} from "../../../../../generated/prisma/enums";

export const submitReferralApplicationZodSchema = z.object({
    promotionMethod: z.nativeEnum(ReferralPromotionMethod, {
        message: "Promotion method is required",
    }),
    promotionUrl: z
        .string()
        .trim()
        .max(2048, "Promotion URL is too long")
        .url("Promotion URL must be a valid URL")
        .optional()
        .or(z.literal("")),
    reason: z
        .string()
        .trim()
        .min(10, "Reason must be at least 10 characters")
        .max(1000, "Reason is too long"),
    termsAccepted: z.boolean().optional(),
});

export const reviewReferralApplicationZodSchema = z.object({
    status: z.nativeEnum(ReferralApplicationStatus),
    rejectionReason: z.string().trim().min(1, "Rejection reason is required").optional(),
});

export const ReferralApplicationValidation = {
    submitReferralApplicationZodSchema,
    reviewReferralApplicationZodSchema,
};
