import { describe, expect, it } from "vitest";
import { ProductOrderStatus, ProductPaymentStatus } from "../../../../generated/prisma/enums";
import {
    checkoutZodSchema,
    updateProductOrderPaymentZodSchema,
    updateProductOrderStatusZodSchema,
} from "./productOrder.validation";

const issuePaths = (schema: { safeParse: (value: unknown) => unknown }, payload: unknown): string[] => {
    const result = schema.safeParse(payload) as
        | { success: true }
        | { success: false; error: { issues: { path: (string | number)[] }[] } };

    return result.success
        ? []
        : result.error.issues.map((issue) => issue.path.join("."));
};

const checkoutIssuePaths = (payload: unknown) =>
    issuePaths(checkoutZodSchema, payload);

const validAddress = {
    recipientName: "Karim Ahmed",
    phone: "+8801712345678",
    division: "Dhaka",
    district: "Dhaka",
};

const validCheckout = {
    idempotencyKey: "checkout-attempt-0001",
    shippingAddress: validAddress,
};

describe("checkoutZodSchema", () => {
    it("accepts an inline delivery snapshot", () => {
        expect(checkoutZodSchema.safeParse(validCheckout).success).toBe(true);
    });

    it("accepts a saved address id instead of a snapshot", () => {
        expect(
            checkoutZodSchema.safeParse({
                idempotencyKey: "checkout-attempt-0002",
                addressId: "addr-1",
            }).success,
        ).toBe(true);
    });

    it("requires an idempotency key", () => {
        expect(
            checkoutIssuePaths({
                shippingAddress: validAddress,
            }),
        ).toContain("idempotencyKey");
    });

    it("rejects an idempotency key that is too short to be unique", () => {
        expect(
            checkoutIssuePaths({
                idempotencyKey: "short",
                shippingAddress: validAddress,
            }),
        ).toContain("idempotencyKey");
    });

    it("rejects an over-long idempotency key", () => {
        expect(
            checkoutIssuePaths({
                idempotencyKey: "k".repeat(101),
                shippingAddress: validAddress,
            }),
        ).toContain("idempotencyKey");
    });

    it("requires a delivery address", () => {
        expect(
            checkoutIssuePaths({ idempotencyKey: "checkout-attempt-0003" }),
        ).toContain("shippingAddress");
    });

    it("refuses an ambiguous request that supplies both address sources", () => {
        expect(
            checkoutIssuePaths({
                idempotencyKey: "checkout-attempt-0004",
                addressId: "addr-1",
                shippingAddress: validAddress,
            }),
        ).toContain("shippingAddress");
    });

    it("requires the recipient and the coarse delivery levels", () => {
        const paths = checkoutIssuePaths({
            idempotencyKey: "checkout-attempt-0005",
            shippingAddress: { phone: "+8801712345678" },
        });

        expect(paths).toContain("shippingAddress.recipientName");
        expect(paths).toContain("shippingAddress.division");
        expect(paths).toContain("shippingAddress.district");
    });

    it.each([
        ["letters", "not-a-phone"],
        ["too few digits", "123"],
    ])("rejects a phone number with %s", (_label, phone) => {
        expect(
            checkoutIssuePaths({
                idempotencyKey: "checkout-attempt-0006",
                shippingAddress: { ...validAddress, phone },
            }),
        ).toContain("shippingAddress.phone");
    });

    it("rejects a note longer than the allowed length", () => {
        expect(
            checkoutIssuePaths({
                ...validCheckout,
                customerNote: "x".repeat(1001),
            }),
        ).toContain("customerNote");
    });

    it.each([
        "price",
        "unitPrice",
        "lineTotal",
        "subtotal",
        "discountAmount",
        "shippingAmount",
        "grandTotal",
        "currency",
        "status",
        "paymentStatus",
        "paidAt",
        "userId",
        "orderNumber",
        "idempotencyKeyHash",
        "availableQuantity",
        "items",
    ])("strips the protected field %s sent by a client", (field) => {
        const result = checkoutZodSchema.safeParse({
            ...validCheckout,
            [field]: field === "items" ? [{ sku: "SKU-1", quantity: 1 }] : 1,
        });

        expect(result.success).toBe(true);

        if (result.success) {
            expect(result.data).not.toHaveProperty(field);
        }
    });

    it("only accepts COD as a payment method", () => {
        expect(
            checkoutZodSchema.safeParse({
                ...validCheckout,
                paymentMethod: "COD",
            }).success,
        ).toBe(true);

        expect(
            checkoutIssuePaths({
                ...validCheckout,
                paymentMethod: "BKASH",
            }),
        ).toContain("paymentMethod");
    });
});

describe("updateProductOrderStatusZodSchema", () => {
    it("requires a status", () => {
        expect(issuePaths(updateProductOrderStatusZodSchema, {})).toContain(
            "status",
        );
    });

    it("rejects an unknown status", () => {
        expect(
            issuePaths(updateProductOrderStatusZodSchema, { status: "REFUNDED" }),
        ).toContain("status");
    });

    it.each(Object.values(ProductOrderStatus))("accepts %s", (status) => {
        expect(
            updateProductOrderStatusZodSchema.safeParse({ status }).success,
        ).toBe(true);
    });

    it("strips a payment status smuggled in with a fulfilment update", () => {
        const result = updateProductOrderStatusZodSchema.safeParse({
            status: ProductOrderStatus.CONFIRMED,
            paymentStatus: ProductPaymentStatus.PAID,
        });

        expect(result.success).toBe(true);

        if (result.success) {
            expect(result.data).toEqual({ status: ProductOrderStatus.CONFIRMED });
        }
    });
});

describe("updateProductOrderPaymentZodSchema", () => {
    it("requires a payment status", () => {
        expect(issuePaths(updateProductOrderPaymentZodSchema, {})).toContain(
            "paymentStatus",
        );
    });

    it("rejects a value from the Telecom payment vocabulary", () => {
        expect(
            issuePaths(updateProductOrderPaymentZodSchema, {
                paymentStatus: "REFUNDED",
            }),
        ).toContain("paymentStatus");
    });

    it.each(Object.values(ProductPaymentStatus))("accepts %s", (status) => {
        expect(
            updateProductOrderPaymentZodSchema.safeParse({ paymentStatus: status })
                .success,
        ).toBe(true);
    });
});
