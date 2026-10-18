import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { Role } from "../../../../generated/prisma/enums";

const mocks = vi.hoisted(() => ({
    sendResponse: vi.fn(),
    getAllOperatorOffers: vi.fn(),
    getOperatorOfferById: vi.fn(),
}));

vi.mock("../../../shared/sendResponse", () => ({
    sendResponse: mocks.sendResponse,
}));

vi.mock("./operatorOffer.service", () => ({
    OperatorOfferService: {
        getAllOperatorOffers: mocks.getAllOperatorOffers,
        getOperatorOfferById: mocks.getOperatorOfferById,
    },
}));

import { OperatorOfferController } from "./operatorOffer.controller";

const SENSITIVE_FIELDS = [
    "companyPurchasePrice",
    "resellerCommissionType",
    "resellerCommissionValue",
    "agentCommissionType",
    "agentCommissionValue",
    "commissionRate",
    "referralCommissionRate",
] as const;

const storedOffer = (overrides: Record<string, unknown> = {}) => ({
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
});

const buildReq = (role?: Role) =>
    ({
        query: {},
        params: { id: "offer-1" },
        user: role ? { userId: "u-1", role, email: "u@example.com" } : undefined,
    }) as unknown as Request;

const res = {} as Response;
const next = vi.fn();

const lastResponse = () => mocks.sendResponse.mock.calls[0][1] as {
    data: unknown;
    meta?: unknown;
};

beforeEach(() => {
    vi.clearAllMocks();
});

describe("GET /operator-offers (getAllOperatorOffers)", () => {
    beforeEach(() => {
        mocks.getAllOperatorOffers.mockResolvedValue({
            data: [storedOffer()],
            meta: { page: 1, limit: 10, totalPages: 1 },
        });
    });

    it("returns the public projection to anonymous callers", async () => {
        await OperatorOfferController.getAllOperatorOffers(
            buildReq(),
            res,
            next,
        );

        const { data, meta } = lastResponse();
        const items = data as Array<Record<string, unknown>>;

        for (const field of SENSITIVE_FIELDS) {
            expect(items[0]).not.toHaveProperty(field);
        }
        expect(items[0]).toMatchObject({
            id: "offer-1",
            name: "10 GB Bundle",
            regularPrice: 100,
            price: 80,
        });
        expect(meta).toEqual({ page: 1, limit: 10, totalPages: 1 });
    });

    it("returns the public projection to a non-admin session", async () => {
        await OperatorOfferController.getAllOperatorOffers(
            buildReq(Role.USER),
            res,
            next,
        );

        const items = lastResponse().data as Array<Record<string, unknown>>;
        expect(items[0]).not.toHaveProperty("companyPurchasePrice");
        expect(items[0]).not.toHaveProperty("commissionRate");
    });

    it("keeps the commercial fields for content admins", async () => {
        await OperatorOfferController.getAllOperatorOffers(
            buildReq(Role.ADMIN),
            res,
            next,
        );

        const items = lastResponse().data as Array<Record<string, unknown>>;
        expect(items[0]).toHaveProperty("companyPurchasePrice", 60);
        expect(items[0]).toHaveProperty("resellerCommissionValue", 5);
        expect(items[0]).toHaveProperty("agentCommissionValue", 3);
        expect(items[0]).toHaveProperty("commissionRate", 5);
        expect(items[0]).toHaveProperty("referralCommissionRate", 2);
    });
});

describe("GET /operator-offers/:id (getOperatorOfferById)", () => {
    beforeEach(() => {
        mocks.getOperatorOfferById.mockResolvedValue(storedOffer());
    });

    it("returns the public projection to anonymous callers", async () => {
        await OperatorOfferController.getOperatorOfferById(
            buildReq(),
            res,
            next,
        );

        const item = lastResponse().data as Record<string, unknown>;

        for (const field of SENSITIVE_FIELDS) {
            expect(item).not.toHaveProperty(field);
        }
        expect(item).toMatchObject({
            id: "offer-1",
            name: "10 GB Bundle",
            regularPrice: 100,
        });
        expect(item.operator).toEqual({
            id: "op-1",
            name: "Grameenphone",
            code: "GP",
            logo: null,
            isActive: true,
        });
    });

    it("returns the public projection to a non-admin session", async () => {
        await OperatorOfferController.getOperatorOfferById(
            buildReq(Role.MODERATOR),
            res,
            next,
        );

        const item = lastResponse().data as Record<string, unknown>;
        expect(item).not.toHaveProperty("companyPurchasePrice");
        expect(item).not.toHaveProperty("referralCommissionRate");
    });

    it("keeps the commercial fields for content admins", async () => {
        await OperatorOfferController.getOperatorOfferById(
            buildReq(Role.SUPER_ADMIN),
            res,
            next,
        );

        const item = lastResponse().data as Record<string, unknown>;
        expect(item).toHaveProperty("companyPurchasePrice", 60);
        expect(item).toHaveProperty("commissionRate", 5);
        expect(item).toHaveProperty("referralCommissionRate", 2);
    });
});
