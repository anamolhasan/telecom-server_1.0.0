import { z } from "zod";
import {
    ProductOrderStatus,
    ProductPaymentMethod,
    ProductPaymentStatus,
} from "../../../../generated/prisma/enums";

// Matches the cart module's per-line cap. A cart row is application-validated
// rather than DB-constrained, so checkout re-checks the range defensively and
// rejects anything a client could not have created through the API.
export const MAX_ORDER_LINE_QUANTITY = 99;

// Delivery phone: enough for Bangladeshi and international formats while staying
// inside the VarChar(30) column. Loose on formatting, strict on characters so a
// courier-facing field can never carry arbitrary text.
const phoneZodSchema = z
    .string()
    .trim()
    .min(6, "Phone number is too short")
    .max(30, "Phone number is too long")
    .regex(/^[+]?[0-9][0-9\s\-()]*$/, "Enter a valid phone number");

export const shippingAddressZodSchema = z.object({
    recipientName: z
        .string()
        .trim()
        .min(2, "Recipient name is too short")
        .max(150, "Recipient name is too long"),
    phone: phoneZodSchema,
    division: z.string().trim().min(1, "Division is required").max(100),
    district: z.string().trim().min(1, "District is required").max(100),
    upazila: z.string().trim().max(100).optional(),
    unionArea: z.string().trim().max(100).optional(),
    villageRoad: z.string().trim().max(255).optional(),
    postalCode: z.string().trim().max(10).optional(),
});

export const checkoutZodSchema = z
    .object({
        // One key per checkout attempt. Bounded so it cannot be used as a
        // free-form storage channel, and long enough for a UUID.
        idempotencyKey: z
            .string()
            .trim()
            .min(8, "Idempotency key must be at least 8 characters")
            .max(100, "Idempotency key is too long"),
        paymentMethod: z.nativeEnum(ProductPaymentMethod).optional(),
        addressId: z.string().trim().min(1).optional(),
        shippingAddress: shippingAddressZodSchema.optional(),
        customerNote: z.string().trim().max(1000).optional(),
    })
    .superRefine((value, ctx) => {
        const hasSavedAddress = value.addressId !== undefined;
        const hasInlineAddress = value.shippingAddress !== undefined;

        // Both would be ambiguous and neither leaves the order without a
        // delivery target, so exactly one is required.
        if (hasSavedAddress === hasInlineAddress) {
            ctx.addIssue({
                code: "custom",
                path: ["shippingAddress"],
                message:
                    "Provide either addressId or shippingAddress, but not both",
            });
        }
    });

// Fulfilment status only. Payment collection is a separate concern and a
// separate endpoint (see updateProductOrderPaymentZodSchema).
export const updateProductOrderStatusZodSchema = z.object({
    status: z.nativeEnum(ProductOrderStatus),
});

export const updateProductOrderPaymentZodSchema = z.object({
    paymentStatus: z.nativeEnum(ProductPaymentStatus),
});

export const ProductOrderValidation = {
    checkoutZodSchema,
    updateProductOrderStatusZodSchema,
    updateProductOrderPaymentZodSchema,
};
