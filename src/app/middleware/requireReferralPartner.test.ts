import { afterEach, describe, expect, it, vi } from "vitest";
import status from "http-status";
import { ReferralApplicationStatus } from "../../generated/prisma/enums";
import { requireReferralPartner } from "./requireReferralPartner";

const mocks = vi.hoisted(() => ({
    findFirst: vi.fn(),
}));

vi.mock("../lib/prisma", () => ({
    prisma: {
        referralApplication: {
            findFirst: mocks.findFirst,
        },
    },
}));

afterEach(() => {
    vi.clearAllMocks();
});

const buildRequest = (userId = "user-1") =>
    ({ user: { userId, role: "USER", email: "u@example.com" } }) as never;

describe("requireReferralPartner", () => {
    it("forwards when the caller has an approved referral application", async () => {
        mocks.findFirst.mockResolvedValue({
            status: ReferralApplicationStatus.APPROVED,
        });

        const next = vi.fn();
        await requireReferralPartner(buildRequest(), {} as never, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith();
    });

    it("rejects when the caller has no referral application", async () => {
        mocks.findFirst.mockResolvedValue(null);

        const next = vi.fn();
        await requireReferralPartner(buildRequest(), {} as never, next);

        expect(next).toHaveBeenCalledWith(
            expect.objectContaining({ statusCode: status.FORBIDDEN }),
        );
    });

    it("rejects when the referral application is not approved", async () => {
        mocks.findFirst.mockResolvedValue({
            status: ReferralApplicationStatus.PENDING,
        });

        const next = vi.fn();
        await requireReferralPartner(buildRequest(), {} as never, next);

        expect(next).toHaveBeenCalledWith(
            expect.objectContaining({ statusCode: status.FORBIDDEN }),
        );
    });
});
