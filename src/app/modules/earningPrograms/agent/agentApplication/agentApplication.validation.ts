import { z } from "zod";
import { AgentApplicationStatus } from "../../../../../generated/prisma/enums";

export const submitAgentApplicationZodSchema = z.object({
    reason: z
        .string()
        .trim()
        .min(1, "Reason cannot be empty")
        .max(2000, "Reason is too long")
        .optional(),
});

export const reviewAgentApplicationZodSchema = z.object({
    status: z.nativeEnum(AgentApplicationStatus),
    rejectionReason: z.string().trim().min(1, "Rejection reason is required").optional(),
});

export const AgentApplicationValidation = {
    submitAgentApplicationZodSchema,
    reviewAgentApplicationZodSchema,
};