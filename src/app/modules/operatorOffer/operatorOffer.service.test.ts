import { beforeEach, describe, expect, it, vi } from "vitest";
import { OperatorOfferStatus } from "../../../generated/prisma/enums";
import { OperatorOfferService } from "./operatorOffer.service";

const mocks = vi.hoisted(() => ({
    operatorFindFirst: vi.fn(),
    offerCreate: vi.fn(),
    offerUpdate: vi.fn(),
    offerFindFirst: vi.fn(),
}));

vi.mock("../../lib/prisma", () => ({
    prisma: {
        operator: { findFirst: mocks.operatorFindFirst },
        operatorOffer: {
            create: mocks.offerCreate,
            update: mocks.offerUpdate,
            findFirst: mocks.offerFindFirst,
        },
    },
}));

const start = new Date("2026-01-01T00:00:00.000Z");
const end = new Date("2026-02-01T00:00:00.000Z");

const payload = (overrides: Record<string, unknown> = {}) => ({
    operatorId: "op-1",
    name: "10 GB Bundle",
    regularPrice: 100,
    startsAt: start,
    endsAt: end,
    ...overrides,
});

const storedRow = (overrides: Record<string, unknown> = {}) => ({
    id: "offer-1",
    operatorId: "op-1",
    name: "10 GB Bundle",
    description: null,
    offerType: "OTHER",
    type: "OTHER",
    amount: null,
    amountUnit: null,
    validityValue: null,
    validityUnit: null,
    regularPrice: 100,
    price: 100,
    discountType: "NONE",
    discountValue: 0,
    companyPurchasePrice: 0,
    resellerCommissionType: "FIXED",
    resellerCommissionValue: 0,
    agentCommissionType: "FIXED",
    agentCommissionValue: 0,
    commissionRate: 0,
    referralCommissionRate: 0,
    inventoryMode: "UNLIMITED",
    stockQuantity: null,
    badges: [],
    startsAt: start,
    endsAt: end,
    status: "DRAFT",
    isActive: false,
    isDeleted: false,
    deletedAt: null,
    operator: { id: "op-1", name: "Grameenphone" },
    ...overrides,
});

beforeEach(() => {
    vi.clearAllMocks();
    mocks.operatorFindFirst.mockResolvedValue({ id: "op-1" });
});

describe("OperatorOfferService.createOperatorOffer", () => {
    it("computes selling price and commission rate server-side", async () => {
        mocks.offerCreate.mockImplementation(
            ({ data }: { data: Record<string, unknown> }) => ({
                id: "offer-1",
                ...data,
                operator: { id: "op-1", name: "Grameenphone" },
            }),
        );

        await OperatorOfferService.createOperatorOffer(
            payload({
                offerType: "MB",
                discountType: "FIXED",
                discountValue: 20,
                resellerCommissionType: "PERCENTAGE",
                resellerCommissionValue: 10,
                status: "ACTIVE",
            }) as never,
        );

        const data = mocks.offerCreate.mock.calls[0][0].data as Record<
            string,
            unknown
        >;

        expect(data.price).toBe(80);
        expect(data.commissionRate).toBe(10);
        expect(data.isActive).toBe(true);
        expect(data.type).toBe("INTERNET");
    });

    it("ignores client-supplied financial fields (mass assignment)", async () => {
        mocks.offerCreate.mockImplementation(
            ({ data }: { data: Record<string, unknown> }) => ({
                id: "offer-1",
                ...data,
                operator: { id: "op-1", name: "Grameenphone" },
            }),
        );

        await OperatorOfferService.createOperatorOffer(
            payload({
                price: 1,
                commissionRate: 99,
                referralCommissionRate: 99,
                isDeleted: true,
            }) as never,
        );

        const data = mocks.offerCreate.mock.calls[0][0].data as Record<
            string,
            unknown
        >;

        expect(data.price).toBe(100);
        expect(data.commissionRate).toBe(0);
        expect(data.isDeleted).toBeUndefined();
    });

    it("leaves isActive false for a non-active status", async () => {
        mocks.offerCreate.mockImplementation(
            ({ data }: { data: Record<string, unknown> }) => ({ id: "o", ...data }),
        );

        await OperatorOfferService.createOperatorOffer(
            payload({ status: "DRAFT" }) as never,
        );

        expect(mocks.offerCreate.mock.calls[0][0].data.isActive).toBe(false);
    });

    it("rejects an unknown operator", async () => {
        mocks.operatorFindFirst.mockResolvedValue(null);

        await expect(
            OperatorOfferService.createOperatorOffer(payload() as never),
        ).rejects.toThrow("Operator not found");

        expect(mocks.offerCreate).not.toHaveBeenCalled();
    });
});

describe("OperatorOfferService.getOperatorOfferById", () => {
    it("serialises decimal money columns to numbers", async () => {
        mocks.offerFindFirst.mockResolvedValue(
            storedRow({
                regularPrice: { valueOf: () => 120.5 },
                companyPurchasePrice: { valueOf: () => 30.25 },
            }),
        );

        const result = await OperatorOfferService.getOperatorOfferById("offer-1");

        expect(result.regularPrice).toBe(120.5);
        expect(result.companyPurchasePrice).toBe(30.25);
    });

    it("throws when the offer does not exist or is archived", async () => {
        mocks.offerFindFirst.mockResolvedValue(null);

        await expect(
            OperatorOfferService.getOperatorOfferById("missing"),
        ).rejects.toThrow("Operator offer not found");
    });
});

describe("OperatorOfferService.updateOperatorOffer", () => {
    it("re-validates the merged row and rejects invalid patches", async () => {
        mocks.offerFindFirst.mockResolvedValue(storedRow());

        await expect(
            OperatorOfferService.updateOperatorOffer("offer-1", {
                discountType: "FIXED",
                discountValue: 500,
            } as never),
        ).rejects.toThrow("Discount cannot exceed the regular price");

        expect(mocks.offerUpdate).not.toHaveBeenCalled();
    });

    it("persists a valid patch", async () => {
        mocks.offerFindFirst.mockResolvedValue(storedRow());
        mocks.offerUpdate.mockImplementation(
            ({ data }: { data: Record<string, unknown> }) => ({
                id: "offer-1",
                ...data,
                operator: { id: "op-1", name: "Grameenphone" },
            }),
        );

        await OperatorOfferService.updateOperatorOffer("offer-1", {
            name: "Updated",
            status: "ACTIVE",
        } as never);

        const data = mocks.offerUpdate.mock.calls[0][0].data as Record<
            string,
            unknown
        >;

        expect(data.name).toBe("Updated");
        expect(data.isActive).toBe(true);
    });

    it("throws when the offer does not exist", async () => {
        mocks.offerFindFirst.mockResolvedValue(null);

        await expect(
            OperatorOfferService.updateOperatorOffer("missing", {
                name: "x",
            } as never),
        ).rejects.toThrow("Operator offer not found");
    });
});

describe("OperatorOfferService.changeOperatorOfferStatus", () => {
    it("pauses an active offer", async () => {
        mocks.offerFindFirst.mockResolvedValue(
            storedRow({ status: "ACTIVE", isActive: true }),
        );
        mocks.offerUpdate.mockImplementation(
            ({ data }: { data: Record<string, unknown> }) => ({ id: "o", ...data }),
        );

        await OperatorOfferService.changeOperatorOfferStatus("offer-1", "pause");

        expect(mocks.offerUpdate.mock.calls[0][0].data).toMatchObject({
            status: OperatorOfferStatus.PAUSED,
            isActive: false,
        });
    });

    it("refuses to pause a non-active offer", async () => {
        mocks.offerFindFirst.mockResolvedValue(
            storedRow({ status: "DRAFT", isActive: false }),
        );

        await expect(
            OperatorOfferService.changeOperatorOfferStatus("offer-1", "pause"),
        ).rejects.toThrow("Only active offers can be paused");
    });

    it("resumes a paused offer", async () => {
        mocks.offerFindFirst.mockResolvedValue(
            storedRow({ status: "PAUSED", isActive: false }),
        );
        mocks.offerUpdate.mockImplementation(
            ({ data }: { data: Record<string, unknown> }) => ({ id: "o", ...data }),
        );

        await OperatorOfferService.changeOperatorOfferStatus("offer-1", "resume");

        expect(mocks.offerUpdate.mock.calls[0][0].data).toMatchObject({
            status: OperatorOfferStatus.ACTIVE,
            isActive: true,
        });
    });

    it("refuses to resume a non-paused offer", async () => {
        mocks.offerFindFirst.mockResolvedValue(
            storedRow({ status: "ACTIVE", isActive: true }),
        );

        await expect(
            OperatorOfferService.changeOperatorOfferStatus("offer-1", "resume"),
        ).rejects.toThrow("Only paused offers can be resumed");
    });

    it("soft-deletes on archive, preserving the row", async () => {
        mocks.offerFindFirst.mockResolvedValue(storedRow());
        mocks.offerUpdate.mockImplementation(
            ({ data }: { data: Record<string, unknown> }) => ({ id: "o", ...data }),
        );

        await OperatorOfferService.archiveOperatorOffer("offer-1");

        const data = mocks.offerUpdate.mock.calls[0][0].data as Record<
            string,
            unknown
        >;

        expect(data.isDeleted).toBe(true);
        expect(data.isActive).toBe(false);
        expect(data.deletedAt).toBeInstanceOf(Date);
        expect(mocks.offerUpdate).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: "offer-1" } }),
        );
    });

    it("throws for a missing offer", async () => {
        mocks.offerFindFirst.mockResolvedValue(null);

        await expect(
            OperatorOfferService.changeOperatorOfferStatus("missing", "archive"),
        ).rejects.toThrow("Operator offer not found");
    });
});
