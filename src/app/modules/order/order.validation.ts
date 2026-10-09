import { z } from "zod";
import { OrderStatus } from "../../../generated/prisma/enums";

export const createOrderZodSchema = z.object({
    productId: z.string().min(1, "Product is required"),
    quantity: z.number().int().positive().optional(),
    targetNumber: z.string().optional(),
    note: z.string().optional(),
});

export const updateOrderStatusZodSchema = z.object({
    status: z.nativeEnum(OrderStatus),
});

export const OrderValidation = {
    createOrderZodSchema,
    updateOrderStatusZodSchema,
};
