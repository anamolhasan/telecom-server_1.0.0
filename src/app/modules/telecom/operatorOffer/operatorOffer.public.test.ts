import { describe, expect, it } from "vitest";
import type { OperatorOffer } from "../../../../generated/prisma/client";
import {
    toPublicOperatorOffer,
    toPublicOperatorOffers,
} from "./operatorOffer.public";

// Internal commercial fields that must never appear in a public projection.
const SENSITIVE_FIELDS = [
    "companyPurchasePrice",
    "resellerCommissionType",
    "resellerCommissionValue",
    "agentCommissionType",
    "agentCommissionValue",
    "commissionRate",
    "referralCommissionRate",
] as const;

const storedOffer = (overrides: Record<string, unknown> = {}) =>
    ({
        id: "offer-1",
        operatorId: "op-1",
        name: "10 GB Bundle",
        description: "A bundle",
        offerType: "MB",
        type: "INTERNET",
        amount: 10,
        amountUnit: "GB",
        validityValue: 30,
        validityUnit: "DAYS",
        regularPrice: 100,
        price: 80,
        discountType: "FIXED",
        discountValue: 20,
        companyPurchasePrice: 60,
        resellerCommissionType: "PERCENTAGE",
        resellerCommissionValue: 5,
        agentCommissionType: "FIXED",
        agentCommissionValue: 3,
        commissionRate: 5,
        referralCommissionRate: 2,
        inventoryMode: "UNLIMITED",
        stockQuantity: null,
        badges: ["NEW"],
        startsAt: new Date("2026-01-01T00:00:00.000Z"),
        endsAt: new Date("2026-02-01T00:00:00.000Z"),
        status: "ACTIVE",
        isActive: true,
        isDeleted: false,
        deletedAt: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        operator: {
            id: "op-1",
            name: "Grameenphone",
            code: "GP",
            logo: null,
            isActive: true,
            isDeleted: false,
        },
        ...overrides,
    }) as unknown as OperatorOffer;

describe("toPublicOperatorOffer", () => {
    it("omits every internal commercial field", () => {
        const projected = toPublicOperatorOffer(storedOffer());

        for (const field of SENSITIVE_FIELDS) {
            expect(projected).not.toHaveProperty(field);
        }
    });

    it("keeps the fields the public catalogue relies on", () => {
        const projected = toPublicOperatorOffer(storedOffer());

        expect(projected).toMatchObject({
            id: "offer-1",
            operatorId: "op-1",
            name: "10 GB Bundle",
            description: "A bundle",
            offerType: "MB",
            type: "INTERNET",
            amount: 10,
            amountUnit: "GB",
            validityValue: 30,
            validityUnit: "DAYS",
            regularPrice: 100,
            price: 80,
            discountType: "FIXED",
            discountValue: 20,
            inventoryMode: "UNLIMITED",
            badges: ["NEW"],
            status: "ACTIVE",
            isActive: true,
            isDeleted: false,
        });
        expect(projected.startsAt).toEqual(new Date("2026-01-01T00:00:00.000Z"));
        expect(projected.endsAt).toEqual(new Date("2026-02-01T00:00:00.000Z"));
    });

    it("projects the nested operator as an explicit public allowlist", () => {
        const projected = toPublicOperatorOffer(storedOffer());

        expect(projected.operator).toEqual({
            id: "op-1",
            name: "Grameenphone",
            code: "GP",
            logo: null,
            isActive: true,
        });
    });

    it("drops unknown/internal fields that are not on the allowlist", () => {
        const projected = toPublicOperatorOffer(
            storedOffer({ someFutureInternalField: "secret" }),
        );

        expect(projected).not.toHaveProperty("someFutureInternalField");
    });

    it("maps a list of offers to public projections", () => {
        const projected = toPublicOperatorOffers([
            storedOffer(),
            storedOffer({ id: "offer-2", name: "20 GB Bundle" }),
        ]);

        expect(projected).toHaveLength(2);
        expect(projected[1].id).toBe("offer-2");
        expect(projected[1]).not.toHaveProperty("companyPurchasePrice");
    });
});
