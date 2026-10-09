import { z } from "zod";
import { WithdrawalMethod, WithdrawalStatus } from "../../../generated/prisma/enums";

export const createWithdrawalZodSchema = z.object({
    amount: z.number().positive("Amount must be positive"),
    method: z.nativeEnum(WithdrawalMethod),
    accountNumber: z.string().min(1, "Account number is required"),
    accountName: z.string().optional(),
});

export const updateWithdrawalStatusZodSchema = z.object({
    status: z.nativeEnum(WithdrawalStatus),
    adminNote: z.string().optional(),
});

export const WithdrawalValidation = {
    createWithdrawalZodSchema,
    updateWithdrawalStatusZodSchema,
};
