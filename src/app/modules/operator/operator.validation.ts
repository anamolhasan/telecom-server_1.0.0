import { z } from "zod";

export const createOperatorZodSchema = z.object({
    name: z.string().min(1, "Name is required").max(100),
    code: z.string().min(1, "Code is required").max(20),
    logo: z.string().optional(),
    isActive: z.boolean().optional(),
});

export const updateOperatorZodSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    code: z.string().min(1).max(20).optional(),
    logo: z.string().optional(),
    isActive: z.boolean().optional(),
});

export const OperatorValidation = {
    createOperatorZodSchema,
    updateOperatorZodSchema,
};
