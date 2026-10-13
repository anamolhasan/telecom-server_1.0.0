import { z } from "zod";
import { ProductType } from "../../../generated/prisma/enums";

export const createProductZodSchema = z.object({
    operatorId: z.string().min(1, "Operator is required"),
    name: z.string().min(1, "Name is required").max(150),
    description: z.string().optional(),
    type: z.nativeEnum(ProductType).optional(),
    price: z.number().nonnegative("Price must be positive"),
    commissionRate: z.number().min(0).max(100).optional(),
    referralCommissionRate: z.number().min(0).max(100).optional(),
    isActive: z.boolean().optional(),
});

export const updateProductZodSchema = z.object({
    operatorId: z.string().min(1).optional(),
    name: z.string().min(1).max(150).optional(),
    description: z.string().optional(),
    type: z.nativeEnum(ProductType).optional(),
    price: z.number().nonnegative().optional(),
    commissionRate: z.number().min(0).max(100).optional(),
    referralCommissionRate: z.number().min(0).max(100).optional(),
    isActive: z.boolean().optional(),
});

export const ProductValidation = {
    createProductZodSchema,
    updateProductZodSchema,
};
