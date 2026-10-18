import { describe, expect, it } from "vitest";
import {
    changeOperatorOfferStatusZodSchema,
    createOperatorOfferZodSchema,
    updateOperatorOfferZodSchema,
} from "./operatorOffer.validation";

const start = new Date("2026-01-01T00:00:00.000Z");
const end = new Date("2026-02-01T00:00:00.000Z");

const validPayload = (overrides: Record<string, unknown> = {}) => ({
    operatorId: "op-1",
    name: "10 GB Bundle",
    regularPrice: 100,
    startsAt: start,
    endsAt: end,
    ...overrides,
});

const issuePaths = (result: ReturnType<typeof createOperatorOfferZodSchema.safeParse>) =>
    result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));

describe("createOperatorOfferZodSchema", () => {
    it("accepts a minimal valid payload", () => {
        const result = createOperatorOfferZodSchema.safeParse(validPayload());

        expect(result.success).toBe(true);
    });

    it("accepts a fully specified payload", () => {
        const result = createOperatorOfferZodSchema.safeParse(
            validPayload({
                description: "Great value",
                offerType: "MB",
                amount: 10,
                amountUnit: "GB",
                validityValue: 30,
                validityUnit: "DAYS",
                discountType: "PERCENTAGE",
                discountValue: 10,
                companyPurchasePrice: 50,
                resellerCommissionType: "PERCENTAGE",
                resellerCommissionValue: 5,
                agentCommissionType: "FIXED",
                agentCommissionValue: 8,
                inventoryMode: "LIMITED",
                stockQuantity: 100,
                badges: ["NEW", "POPULAR"],
                status: "ACTIVE",
            }),
        );

        expect(result.success).toBe(true);
    });

    it("strips protected financial and administrative fields", () => {
        const result = createOperatorOfferZodSchema.safeParse(
            validPayload({
                price: 1,
                commissionRate: 99,
                referralCommissionRate: 99,
                isDeleted: true,
                deletedAt: start,
                id: "hacked",
                createdAt: start,
            }),
        );

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data).not.toHaveProperty("price");
            expect(result.data).not.toHaveProperty("commissionRate");
            expect(result.data).not.toHaveProperty("referralCommissionRate");
            expect(result.data).not.toHaveProperty("isDeleted");
            expect(result.data).not.toHaveProperty("deletedAt");
            expect(result.data).not.toHaveProperty("id");
            expect(result.data).not.toHaveProperty("createdAt");
        }
    });

    it("requires operator, name, regular price and dates", () => {
        const result = createOperatorOfferZodSchema.safeParse({});

        expect(result.success).toBe(false);
        expect(issuePaths(result)).toEqual(
            expect.arrayContaining([
                "operatorId",
                "name",
                "regularPrice",
                "startsAt",
                "endsAt",
            ]),
        );
    });

    it("rejects a negative regular price", () => {
        const result = createOperatorOfferZodSchema.safeParse(
            validPayload({ regularPrice: -1 }),
        );

        expect(issuePaths(result)).toContain("regularPrice");
    });

    it("rejects a discount percentage above 100", () => {
        const result = createOperatorOfferZodSchema.safeParse(
            validPayload({ discountType: "PERCENTAGE", discountValue: 120 }),
        );

        expect(issuePaths(result)).toContain("discountValue");
    });

    it("rejects a fixed discount larger than the regular price", () => {
        const result = createOperatorOfferZodSchema.safeParse(
            validPayload({ discountType: "FIXED", discountValue: 150 }),
        );

        expect(issuePaths(result)).toContain("discountValue");
    });

    it("rejects a fixed reseller commission above the selling price", () => {
        const result = createOperatorOfferZodSchema.safeParse(
            validPayload({
                regularPrice: 100,
                resellerCommissionType: "FIXED",
                resellerCommissionValue: 150,
            }),
        );

        expect(issuePaths(result)).toContain("resellerCommissionValue");
    });

    it("rejects a fixed agent commission above the selling price", () => {
        const result = createOperatorOfferZodSchema.safeParse(
            validPayload({
                regularPrice: 100,
                agentCommissionType: "FIXED",
                agentCommissionValue: 101,
            }),
        );

        expect(issuePaths(result)).toContain("agentCommissionValue");
    });

    it("rejects a commission percentage above 100", () => {
        const result = createOperatorOfferZodSchema.safeParse(
            validPayload({
                resellerCommissionType: "PERCENTAGE",
                resellerCommissionValue: 101,
            }),
        );

        expect(issuePaths(result)).toContain("resellerCommissionValue");
    });

    it("requires stock when the inventory mode is LIMITED", () => {
        const result = createOperatorOfferZodSchema.safeParse(
            validPayload({ inventoryMode: "LIMITED" }),
        );

        expect(issuePaths(result)).toContain("stockQuantity");
    });

    it("allows missing stock when the inventory mode is UNLIMITED", () => {
        const result = createOperatorOfferZodSchema.safeParse(
            validPayload({ inventoryMode: "UNLIMITED" }),
        );

        expect(result.success).toBe(true);
    });

    it("rejects a negative stock quantity", () => {
        const result = createOperatorOfferZodSchema.safeParse(
            validPayload({ inventoryMode: "LIMITED", stockQuantity: -1 }),
        );

        expect(issuePaths(result)).toContain("stockQuantity");
    });

    it("rejects a fractional stock quantity", () => {
        const result = createOperatorOfferZodSchema.safeParse(
            validPayload({ inventoryMode: "LIMITED", stockQuantity: 1.5 }),
        );

        expect(issuePaths(result)).toContain("stockQuantity");
    });

    it("rejects a fractional amount (INTEGER column)", () => {
        const result = createOperatorOfferZodSchema.safeParse(
            validPayload({ amount: 1.5 }),
        );

        expect(issuePaths(result)).toContain("amount");
    });

    it("rejects a negative validity", () => {
        const result = createOperatorOfferZodSchema.safeParse(
            validPayload({ validityValue: -5 }),
        );

        expect(issuePaths(result)).toContain("validityValue");
    });

    it("rejects an end date at or before the start", () => {
        const result = createOperatorOfferZodSchema.safeParse(
            validPayload({ startsAt: end, endsAt: start }),
        );

        expect(issuePaths(result)).toContain("endsAt");
    });

    it("rejects invalid date values", () => {
        const result = createOperatorOfferZodSchema.safeParse(
            validPayload({ startsAt: "not-a-date" }),
        );

        expect(issuePaths(result)).toContain("startsAt");
    });
});

describe("updateOperatorOfferZodSchema", () => {
    it("accepts a partial payload", () => {
        const result = updateOperatorOfferZodSchema.safeParse({ name: "New name" });

        expect(result.success).toBe(true);
    });

    it("still enforces end-after-start when both dates are present", () => {
        const result = updateOperatorOfferZodSchema.safeParse({
            startsAt: end,
            endsAt: start,
        });

        expect(result.success).toBe(false);
    });
});

describe("changeOperatorOfferStatusZodSchema", () => {
    it("accepts the supported actions", () => {
        for (const action of ["pause", "resume", "archive"] as const) {
            expect(
                changeOperatorOfferStatusZodSchema.safeParse({ action }).success,
            ).toBe(true);
        }
    });

    it("rejects an unknown action", () => {
        expect(
            changeOperatorOfferStatusZodSchema.safeParse({ action: "delete" })
                .success,
        ).toBe(false);
    });
});
