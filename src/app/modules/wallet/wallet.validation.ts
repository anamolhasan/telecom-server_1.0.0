import { z } from "zod";
import { WalletTransactionReason, WalletTransactionType } from "../../../generated/prisma/enums";

export const adjustWalletZodSchema = z.object({
    userId: z.string().min(1, "User is required"),
    amount: z.number().positive("Amount must be positive"),
    type: z.nativeEnum(WalletTransactionType),
    reason: z.nativeEnum(WalletTransactionReason).optional(),
    description: z.string().optional(),
});

export const WalletValidation = {
    adjustWalletZodSchema,
};
