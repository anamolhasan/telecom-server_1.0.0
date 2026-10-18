import { z } from "zod";

// Per-line cap. It protects the cart (and any later checkout) from absurd
// quantities; stock is deliberately *not* used as the cap here because a cart
// never reserves stock (see cart.service.ts).
export const MAX_CART_ITEM_QUANTITY = 99;

const quantityZodSchema = z
    .number()
    .int("Quantity must be a whole number")
    .min(1, "Quantity must be at least 1")
    .max(
        MAX_CART_ITEM_QUANTITY,
        `Quantity cannot exceed ${MAX_CART_ITEM_QUANTITY}`,
    );

// "Add to cart" without an explicit quantity adds one unit, which is the common
// client behaviour.
export const addCartItemZodSchema = z.object({
    variantId: z.string().trim().min(1, "Product variant is required"),
    quantity: quantityZodSchema.default(1),
});

// Quantity 0 is rejected on purpose: removing a line is a DELETE, so the two
// operations stay distinguishable in the audit trail.
export const updateCartItemZodSchema = z.object({
    quantity: quantityZodSchema,
});

export const CartValidation = {
    addCartItemZodSchema,
    updateCartItemZodSchema,
};
