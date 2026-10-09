import { z } from "zod";
import { ReferralApplicationStatus } from "../../../generated/prisma/enums";

export const reviewReferralApplicationZodSchema = z.object({
    status: z.nativeEnum(ReferralApplicationStatus),
    rejectionReason: z.string().trim().min(1, "Rejection reason is required").optional(),
});

export const ReferralValidation = {
    reviewReferralApplicationZodSchema,
};