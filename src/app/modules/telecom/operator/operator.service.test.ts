import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Operator } from "../../../../generated/prisma/client";
import { OperatorService } from "./operator.service";

// The service talks to Prisma and the Cloudinary deletion helper only. Both are
// mocked here so no database or provider credentials are required.
const mocks = vi.hoisted(() => ({
    operatorFindFirst: vi.fn(),
    operatorCreate: vi.fn(),
    operatorUpdate: vi.fn(),
    operatorCount: vi.fn(),
    transaction: vi.fn(),
    deleteImageByPublicId: vi.fn(),
}));

vi.mock("../../../lib/prisma", () => ({
    prisma: {
        operator: {
            findFirst: mocks.operatorFindFirst,
            create: mocks.operatorCreate,
            update: mocks.operatorUpdate,
            count: mocks.operatorCount,
        },
        $transaction: mocks.transaction,
    },
}));

vi.mock("../../upload/cloudinary.service", () => ({
    deleteImageByPublicId: mocks.deleteImageByPublicId,
}));

const OLD_URL = "https://res.cloudinary.com/demo/image/upload/operators/old.png";
const OLD_ID = "rizqifybd/operators/old";
const NEW_URL = "https://res.cloudinary.com/demo/image/upload/operators/new.png";
const NEW_ID = "rizqifybd/operators/new";
const SAME_URL = "https://res.cloudinary.com/demo/image/upload/operators/same.png";
const SAME_ID = "rizqifybd/operators/same";

const storedOperator = (overrides: Partial<Operator> = {}): Operator => ({
    id: "op-1",
    name: "Grameenphone",
    code: "GP",
    logo: null,
    logoPublicId: null,
    isActive: true,
    isDeleted: false,
    deletedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
});

beforeEach(() => {
    mocks.transaction.mockImplementation(
        async (callback: (client: unknown) => unknown) =>
            callback({
                operator: {
                    findFirst: mocks.operatorFindFirst,
                    create: mocks.operatorCreate,
                    update: mocks.operatorUpdate,
                },
            }),
    );
});

afterEach(() => {
    vi.clearAllMocks();
});

describe("OperatorService.createOperator", () => {
    it("persists both the logo url and its public id", async () => {
        const created = storedOperator({ logo: NEW_URL, logoPublicId: NEW_ID });
        mocks.operatorCreate.mockResolvedValue(created);

        const result = await OperatorService.createOperator({
            name: "Grameenphone",
            code: "GP",
            logo: NEW_URL,
            logoPublicId: NEW_ID,
        });

        expect(mocks.operatorCreate).toHaveBeenCalledWith({
            data: { name: "Grameenphone", code: "GP", logo: NEW_URL, logoPublicId: NEW_ID },
        });
        expect(result).toEqual(created);
        expect(mocks.deleteImageByPublicId).not.toHaveBeenCalled();
    });

    it("rejects an incomplete logo reference", async () => {
        await expect(
            OperatorService.createOperator({ name: "GP", code: "GP", logo: NEW_URL }),
        ).rejects.toMatchObject({ statusCode: 400 });

        await expect(
            OperatorService.createOperator({ name: "GP", code: "GP", logoPublicId: NEW_ID }),
        ).rejects.toMatchObject({ statusCode: 400 });

        expect(mocks.operatorCreate).not.toHaveBeenCalled();
    });
});

describe("OperatorService.updateOperator", () => {
    it("persists the new logo, then removes the replaced asset", async () => {
        mocks.operatorFindFirst.mockResolvedValue(
            storedOperator({ logo: OLD_URL, logoPublicId: OLD_ID }),
        );
        mocks.operatorUpdate.mockResolvedValue(
            storedOperator({ logo: NEW_URL, logoPublicId: NEW_ID }),
        );
        mocks.operatorCount.mockResolvedValue(0);

        await OperatorService.updateOperator("op-1", { logo: NEW_URL, logoPublicId: NEW_ID });

        expect(mocks.operatorUpdate).toHaveBeenCalledWith({
            where: { id: "op-1" },
            data: { logo: NEW_URL, logoPublicId: NEW_ID },
        });
        expect(mocks.deleteImageByPublicId).toHaveBeenCalledTimes(1);
        expect(mocks.deleteImageByPublicId).toHaveBeenCalledWith(OLD_ID);

        const updateOrder = mocks.operatorUpdate.mock.invocationCallOrder[0];
        const deleteOrder = mocks.deleteImageByPublicId.mock.invocationCallOrder[0];
        expect(updateOrder).toBeLessThan(deleteOrder);
    });

    it("never deletes the previous asset when the database update fails", async () => {
        mocks.operatorFindFirst.mockResolvedValue(
            storedOperator({ logo: OLD_URL, logoPublicId: OLD_ID }),
        );
        mocks.operatorUpdate.mockRejectedValue(new Error("database unavailable"));

        await expect(
            OperatorService.updateOperator("op-1", { logo: NEW_URL, logoPublicId: NEW_ID }),
        ).rejects.toThrow("database unavailable");

        expect(mocks.operatorCount).not.toHaveBeenCalled();
        expect(mocks.deleteImageByPublicId).not.toHaveBeenCalled();
    });

    it("does not delete anything when the public id is unchanged", async () => {
        mocks.operatorFindFirst.mockResolvedValue(
            storedOperator({ logo: SAME_URL, logoPublicId: SAME_ID }),
        );
        mocks.operatorUpdate.mockResolvedValue(
            storedOperator({ logo: SAME_URL, logoPublicId: SAME_ID }),
        );

        await OperatorService.updateOperator("op-1", {
            logo: SAME_URL,
            logoPublicId: SAME_ID,
        });

        expect(mocks.operatorCount).not.toHaveBeenCalled();
        expect(mocks.deleteImageByPublicId).not.toHaveBeenCalled();
    });

    it("keeps the previous asset when another operator still references it", async () => {
        mocks.operatorFindFirst.mockResolvedValue(
            storedOperator({ logo: OLD_URL, logoPublicId: OLD_ID }),
        );
        mocks.operatorUpdate.mockResolvedValue(
            storedOperator({ logo: NEW_URL, logoPublicId: NEW_ID }),
        );
        mocks.operatorCount.mockResolvedValue(1);

        await OperatorService.updateOperator("op-1", { logo: NEW_URL, logoPublicId: NEW_ID });

        expect(mocks.operatorCount).toHaveBeenCalledTimes(1);
        expect(mocks.operatorCount).toHaveBeenCalledWith({
            where: {
                NOT: { id: "op-1" },
                OR: [{ logoPublicId: OLD_ID }, { logo: OLD_URL }],
            },
        });
        expect(mocks.deleteImageByPublicId).not.toHaveBeenCalled();
    });

    it("deletes only the stored handle, never one supplied by the client", async () => {
        mocks.operatorFindFirst.mockResolvedValue(
            storedOperator({ logo: OLD_URL, logoPublicId: OLD_ID }),
        );
        mocks.operatorUpdate.mockResolvedValue(
            storedOperator({ logo: NEW_URL, logoPublicId: NEW_ID }),
        );
        mocks.operatorCount.mockResolvedValue(0);

        await OperatorService.updateOperator("op-1", { logo: NEW_URL, logoPublicId: NEW_ID });

        expect(mocks.deleteImageByPublicId).toHaveBeenCalledWith(OLD_ID);
        expect(mocks.deleteImageByPublicId).not.toHaveBeenCalledWith(NEW_ID);
    });

    it("keeps the update successful when Cloudinary deletion fails", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const updated = storedOperator({ logo: NEW_URL, logoPublicId: NEW_ID });
        mocks.operatorFindFirst.mockResolvedValue(
            storedOperator({ logo: OLD_URL, logoPublicId: OLD_ID }),
        );
        mocks.operatorUpdate.mockResolvedValue(updated);
        mocks.operatorCount.mockResolvedValue(0);
        mocks.deleteImageByPublicId.mockRejectedValue(new Error("provider down"));

        await expect(
            OperatorService.updateOperator("op-1", { logo: NEW_URL, logoPublicId: NEW_ID }),
        ).resolves.toEqual(updated);

        expect(warn).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });

    it("does not delete when the reference status cannot be determined", async () => {
        mocks.operatorFindFirst.mockResolvedValue(
            storedOperator({ logo: OLD_URL, logoPublicId: OLD_ID }),
        );
        mocks.operatorUpdate.mockResolvedValue(
            storedOperator({ logo: NEW_URL, logoPublicId: NEW_ID }),
        );
        mocks.operatorCount.mockRejectedValue(new Error("count failed"));

        await expect(
            OperatorService.updateOperator("op-1", { logo: NEW_URL, logoPublicId: NEW_ID }),
        ).resolves.toBeDefined();

        expect(mocks.deleteImageByPublicId).not.toHaveBeenCalled();
    });

    it("keeps legacy operators (null public id) working on replace without deleting", async () => {
        mocks.operatorFindFirst.mockResolvedValue(
            storedOperator({ logo: OLD_URL, logoPublicId: null }),
        );
        mocks.operatorUpdate.mockResolvedValue(
            storedOperator({ logo: NEW_URL, logoPublicId: NEW_ID }),
        );

        await OperatorService.updateOperator("op-1", { logo: NEW_URL, logoPublicId: NEW_ID });

        expect(mocks.operatorUpdate).toHaveBeenCalledTimes(1);
        expect(mocks.operatorCount).not.toHaveBeenCalled();
        expect(mocks.deleteImageByPublicId).not.toHaveBeenCalled();
    });

    it("preserves the existing logo fields on edits that do not touch the logo", async () => {
        const existing = storedOperator({ logo: OLD_URL, logoPublicId: OLD_ID });
        mocks.operatorFindFirst.mockResolvedValue(existing);
        mocks.operatorUpdate.mockImplementation(
            async ({ data }: { data: Record<string, unknown> }) => ({ ...existing, ...data }),
        );

        const result = await OperatorService.updateOperator("op-1", {
            name: "Renamed",
            code: "GP",
        });

        const updateArgs = mocks.operatorUpdate.mock.calls[0][0] as {
            data: Record<string, unknown>;
        };
        expect(updateArgs.data).toEqual({ name: "Renamed", code: "GP" });
        expect(updateArgs.data).not.toHaveProperty("logo");
        expect(updateArgs.data).not.toHaveProperty("logoPublicId");
        expect(result.logo).toBe(OLD_URL);
        expect(result.logoPublicId).toBe(OLD_ID);
        expect(mocks.deleteImageByPublicId).not.toHaveBeenCalled();
    });

    it("rejects replacing a logo without its public id", async () => {
        mocks.operatorFindFirst.mockResolvedValue(
            storedOperator({ logo: OLD_URL, logoPublicId: OLD_ID }),
        );

        await expect(
            OperatorService.updateOperator("op-1", { logo: NEW_URL }),
        ).rejects.toMatchObject({ statusCode: 400 });

        expect(mocks.operatorUpdate).not.toHaveBeenCalled();
        expect(mocks.deleteImageByPublicId).not.toHaveBeenCalled();
    });
});
