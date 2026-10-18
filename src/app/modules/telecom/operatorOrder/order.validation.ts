import { z } from "zod";
import { OrderStatus } from "../../../../generated/prisma/enums";

export const createOrderZodSchema = z.object({
    operatorOfferId: z.string().min(1, "Offer is required"),
    quantity: z.number().int().positive().optional(),
    targetNumber: z.string().optional(),
    note: z.string().optional(),
    buyerId: z.string().min(1).optional(),
});

export const createOrderWithWalletZodSchema = z.object({
    operatorOfferId: z.string().min(1, "Offer is required"),
    quantity: z.number().int().positive().optional(),
    targetNumber: z.string().optional(),
    note: z.string().optional(),
    idempotencyKey: z.string().min(1).max(200).optional(),
});

export const updateOrderStatusZodSchema = z.object({
    status: z.nativeEnum(OrderStatus),
});

export const OrderValidation = {
    createOrderZodSchema,
    createOrderWithWalletZodSchema,
    updateOrderStatusZodSchema,
};
