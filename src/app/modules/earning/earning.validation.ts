import { z } from "zod";
import {
    EarningProgram,
    EarningRuleScope,
    EarningRuleType,
} from "../../../generated/prisma/enums";

// A commission rule is administrative configuration. The target columns are
// validated against the scope in the service (exactly one target for a scoped
// rule, none for GLOBAL) so a rule can never be created with a mismatched scope.
export const createCommissionRuleZodSchema = z.object({
    program: z.nativeEnum(EarningProgram),
    scope: z.nativeEnum(EarningRuleScope),
    ruleType: z.nativeEnum(EarningRuleType),
    value: z
        .number()
        .min(0, "Value cannot be negative")
        .max(1_000_000, "Value is too large"),
    productId: z.string().trim().min(1).optional(),
    productVariantId: z.string().trim().min(1).optional(),
    operatorOfferId: z.string().trim().min(1).optional(),
    isActive: z.boolean().optional(),
    priority: z.number().int().optional(),
    note: z.string().trim().max(255).optional(),
});

export const updateCommissionRuleZodSchema = z.object({
    ruleType: z.nativeEnum(EarningRuleType).optional(),
    value: z
        .number()
        .min(0, "Value cannot be negative")
        .max(1_000_000, "Value is too large")
        .optional(),
    isActive: z.boolean().optional(),
    priority: z.number().int().optional(),
    note: z.string().trim().max(255).optional(),
});

export const EarningValidation = {
    createCommissionRuleZodSchema,
    updateCommissionRuleZodSchema,
};
