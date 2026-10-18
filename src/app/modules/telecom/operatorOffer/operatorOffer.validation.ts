import { z } from "zod";
import {
    OperatorOfferAmountUnit,
    OperatorOfferBadge,
    OperatorOfferCommissionType,
    OperatorOfferDiscountType,
    OperatorOfferInventoryMode,
    OperatorOfferStatus,
    OperatorOfferType,
    OperatorOfferValidityUnit,
} from "../../../../generated/prisma/enums";
import {
    calculateSellingPrice,
    resolveCommissionAmount,
} from "./operatorOffer.calculation";

// Optional numeric fields may arrive as "" or null from forms; normalise those to
// undefined so they are treated as absent rather than as zero.
const optionalNumber = (schema: z.ZodNumber) =>
    z.preprocess(
        (value) =>
            value === "" || value === null || value === undefined
                ? undefined
                : value,
        schema.optional(),
    );

// `amount`, `validityValue` and `stockQuantity` map to INTEGER columns, so a
// fractional value would otherwise reach Prisma and surface as an opaque 500.
// Enforcing integrality here keeps the failure a clean 400 the client can map.
const optionalPositiveInt = (noun: string) =>
    optionalNumber(
        z
            .number()
            .int(`${noun} must be a whole number`)
            .positive(`${noun} must be greater than 0`),
    );

const optionalNonNegativeInt = (noun: string) =>
    optionalNumber(
        z
            .number()
            .int(`${noun} must be a whole number`)
            .nonnegative(`${noun} cannot be negative`),
    );

const baseOfferShape = {
    operatorId: z.string().min(1, "Operator is required"),
    name: z.string().min(1, "Name is required").max(150),
    description: z.string().max(2000).nullish(),
    offerType: z.nativeEnum(OperatorOfferType).nullish(),
    amount: optionalPositiveInt("Amount"),
    amountUnit: z.nativeEnum(OperatorOfferAmountUnit).nullish(),
    validityValue: optionalPositiveInt("Validity"),
    validityUnit: z.nativeEnum(OperatorOfferValidityUnit).nullish(),
    regularPrice: z
        .number()
        .nonnegative("Regular price must be zero or greater"),
    discountType: z.nativeEnum(OperatorOfferDiscountType).nullish(),
    discountValue: z
        .number()
        .nonnegative("Discount value must be zero or greater")
        .nullish(),
    companyPurchasePrice: z
        .number()
        .nonnegative("Company purchase price must be zero or greater")
        .nullish(),
    resellerCommissionType: z
        .nativeEnum(OperatorOfferCommissionType)
        .nullish(),
    resellerCommissionValue: z
        .number()
        .nonnegative("Reseller commission must be zero or greater")
        .nullish(),
    agentCommissionType: z.nativeEnum(OperatorOfferCommissionType).nullish(),
    agentCommissionValue: z
        .number()
        .nonnegative("Agent commission must be zero or greater")
        .nullish(),
    inventoryMode: z.nativeEnum(OperatorOfferInventoryMode).nullish(),
    stockQuantity: optionalNonNegativeInt("Stock quantity"),
    badges: z.array(z.nativeEnum(OperatorOfferBadge)).nullish(),
    startsAt: z.coerce.date({ message: "A valid start date/time is required" }),
    endsAt: z.coerce.date({ message: "A valid end date/time is required" }),
    status: z.nativeEnum(OperatorOfferStatus).nullish(),
    isActive: z.boolean().nullish(),
};

// Business rules that span multiple fields. The same checks the form performs are
// re-enforced here so the server never trusts a client's calculated values.
function refineOfferBusinessRules(
    data: z.infer<z.ZodObject<typeof baseOfferShape>>,
    ctx: z.RefinementCtx,
) {
    const discountType = data.discountType ?? OperatorOfferDiscountType.NONE;
    const discountValue = data.discountValue ?? 0;

    if (discountType === "PERCENTAGE" && discountValue > 100) {
        ctx.addIssue({
            code: "custom",
            message: "Discount percentage cannot exceed 100",
            path: ["discountValue"],
        });
    }

    if (discountType === "FIXED" && discountValue > data.regularPrice) {
        ctx.addIssue({
            code: "custom",
            message: "Discount cannot exceed the regular price",
            path: ["discountValue"],
        });
    }

    const { sellingPrice } = calculateSellingPrice(
        data.regularPrice,
        discountType,
        discountValue,
    );

    const resellerType = data.resellerCommissionType ?? "FIXED";
    const resellerValue = data.resellerCommissionValue ?? 0;
    const agentType = data.agentCommissionType ?? "FIXED";
    const agentValue = data.agentCommissionValue ?? 0;

    if (resellerType === "PERCENTAGE" && resellerValue > 100) {
        ctx.addIssue({
            code: "custom",
            message: "Reseller commission percentage cannot exceed 100",
            path: ["resellerCommissionValue"],
        });
    }

    if (
        resellerType === "FIXED" &&
        resolveCommissionAmount(sellingPrice, resellerType, resellerValue) >
            sellingPrice
    ) {
        ctx.addIssue({
            code: "custom",
            message: "Reseller commission cannot exceed the selling price",
            path: ["resellerCommissionValue"],
        });
    }

    if (agentType === "PERCENTAGE" && agentValue > 100) {
        ctx.addIssue({
            code: "custom",
            message: "Agent commission percentage cannot exceed 100",
            path: ["agentCommissionValue"],
        });
    }

    if (
        agentType === "FIXED" &&
        resolveCommissionAmount(sellingPrice, agentType, agentValue) >
            sellingPrice
    ) {
        ctx.addIssue({
            code: "custom",
            message: "Agent commission cannot exceed the selling price",
            path: ["agentCommissionValue"],
        });
    }

    const inventoryMode =
        data.inventoryMode ?? OperatorOfferInventoryMode.UNLIMITED;

    if (inventoryMode === "LIMITED" && data.stockQuantity === undefined) {
        ctx.addIssue({
            code: "custom",
            message: "Stock quantity is required for limited inventory",
            path: ["stockQuantity"],
        });
    }

    if (data.endsAt.getTime() <= data.startsAt.getTime()) {
        ctx.addIssue({
            code: "custom",
            message: "End date/time must be after the start",
            path: ["endsAt"],
        });
    }
}

// Protected financial/administrative columns (price, commissionRate,
// referralCommissionRate, isDeleted, deletedAt, id, timestamps) are intentionally
// absent: Zod strips unknown keys, so a client cannot mass-assign them.
export const createOperatorOfferZodSchema = z
    .object(baseOfferShape)
    .superRefine(refineOfferBusinessRules);

export const updateOperatorOfferZodSchema = z
    .object(baseOfferShape)
    .partial()
    .superRefine((data, ctx) => {
        // Only run cross-field rules when every field they depend on is present;
        // partial updates are merged with the existing row inside the service.
        if (data.startsAt && data.endsAt) {
            if (data.endsAt.getTime() <= data.startsAt.getTime()) {
                ctx.addIssue({
                    code: "custom",
                    message: "End date/time must be after the start",
                    path: ["endsAt"],
                });
            }
        }
    });

export const changeOperatorOfferStatusZodSchema = z.object({
    action: z.enum(["pause", "resume", "archive"]),
});

export const operatorOfferValidation = {
    createOperatorOfferZodSchema,
    updateOperatorOfferZodSchema,
    changeOperatorOfferStatusZodSchema,
};

export type CreateOperatorOfferInput = z.infer<
    typeof createOperatorOfferZodSchema
>;
export type UpdateOperatorOfferInput = z.infer<
    typeof updateOperatorOfferZodSchema
>;
