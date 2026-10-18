import { afterEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "../../../../../generated/prisma/client";
import {
    AffiliateApplicationStatus,
    Role,
} from "../../../../../generated/prisma/enums";
import { AffiliateApplicationService } from "./affiliateApplication.service";


interface ISubmitOverrides {
    appUser?: { id: string; authUserId: string; isDeleted: boolean } | null;
    existing?: { id: string; appUserId: string; status: AffiliateApplicationStatus } | null;
}

const makeSubmitClient = (overrides: ISubmitOverrides = {}) => {
    const tx = {
        appUser: {
            findUnique: vi.fn().mockResolvedValue(
                overrides.appUser === undefined
                    ? { id: "app1", authUserId: "user1", isDeleted: false }
                    : overrides.appUser,
            ),
        },
        affiliateApplication: {
            findUnique: vi.fn().mockResolvedValue(overrides.existing ?? null),
            create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
                id: "afa-new",
                ...args.data,
            })),
        },
        $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    };

    return { client: tx as unknown as Prisma.TransactionClient, tx };
};

interface IReviewOverrides {
    application?: {
        id: string;
        appUserId: string;
        status: AffiliateApplicationStatus;
        appUser: { authUserId: string };
    } | null;
    ownApplication?: boolean;
}

const makeReviewClient = (overrides: IReviewOverrides = {}) => {
    const authUserId = overrides.ownApplication ? "admin1" : "user1";
    const application =
        overrides.application === undefined
            ? {
                  id: "afa1",
                  appUserId: "app1",
                  status: AffiliateApplicationStatus.PENDING,
                  appUser: { authUserId },
              }
            : overrides.application;

    let storedStatus = application?.status;

    const tx = {
        affiliateApplication: {
            findUnique: vi.fn(async () => {
                if (!application) return null;
                return { ...application, status: storedStatus };
            }),
            update: vi.fn(
                async (args: { where: { id: string }; data: Record<string, unknown> }) => {
                    storedStatus = args.data.status as AffiliateApplicationStatus;
                    return { id: args.where.id, ...args.data };
                },
            ),
        },
        $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    };

    return { client: tx as unknown as Prisma.TransactionClient, tx };
};

const adminUser = { userId: "admin1", role: Role.ADMIN, email: "admin@x.com" };
const superAdminUser = { userId: "sa1", role: Role.SUPER_ADMIN, email: "sa@x.com" };
const userUser = { userId: "user1", role: Role.USER, email: "user@x.com" };
const staffUser = { userId: "staff1", role: Role.EMPLOYEE, email: "staff@x.com" };

afterEach(() => {
    vi.clearAllMocks();
});

describe("submitAffiliateApplication", () => {
    it("allows a USER to submit an application", async () => {
        const { client, tx } = makeSubmitClient();

        const result = await AffiliateApplicationService.submitAffiliateApplication(
            userUser,
            { reason: "I want to promote offers as an affiliate" },
            client,
        );

        expect(result.status).toBe(AffiliateApplicationStatus.PENDING);
        expect(result.reason).toBe("I want to promote offers as an affiliate");
        expect(tx.affiliateApplication.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ appUserId: "app1" }),
            }),
        );
    });

    it("allows a staff account to apply (a role never gates program membership)", async () => {
        const { client, tx } = makeSubmitClient();

        const result = await AffiliateApplicationService.submitAffiliateApplication(
            staffUser,
            {},
            client,
        );

        expect(result.status).toBe(AffiliateApplicationStatus.PENDING);
        expect(tx.affiliateApplication.create).toHaveBeenCalledTimes(1);
    });

    it("rejects a second (duplicate) application", async () => {
        const { client } = makeSubmitClient({
            existing: {
                id: "afa1",
                appUserId: "app1",
                status: AffiliateApplicationStatus.PENDING,
            },
        });

        await expect(
            AffiliateApplicationService.submitAffiliateApplication(userUser, {}, client),
        ).rejects.toThrow("already submitted");
    });

    it("rejects an application from a deleted app user", async () => {
        const { client } = makeSubmitClient({
            appUser: { id: "app1", authUserId: "user1", isDeleted: true },
        });

        await expect(
            AffiliateApplicationService.submitAffiliateApplication(userUser, {}, client),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it("rejects an application when no app user exists", async () => {
        const { client } = makeSubmitClient({ appUser: null });
        await expect(
            AffiliateApplicationService.submitAffiliateApplication(userUser, {}, client),
        ).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe("reviewAffiliateApplication", () => {
    it("ADMIN approves and records the reviewer + review time", async () => {
        const { client } = makeReviewClient();
        const reviewedAt = new Date("2026-10-18T12:00:00.000Z");
        vi.useFakeTimers();
        vi.setSystemTime(reviewedAt);

        const result = await AffiliateApplicationService.reviewAffiliateApplication(
            "afa1",
            { status: AffiliateApplicationStatus.APPROVED },
            adminUser,
            client,
        );

        expect(result.status).toBe(AffiliateApplicationStatus.APPROVED);
        expect(result.reviewedById).toBe("admin1");
        expect(result.reviewedAt).toEqual(reviewedAt);
        expect(result.rejectionReason).toBeNull();

        vi.useRealTimers();
    });

    it("SUPER_ADMIN may also approve", async () => {
        const { client } = makeReviewClient();

        const result = await AffiliateApplicationService.reviewAffiliateApplication(
            "afa1",
            { status: AffiliateApplicationStatus.APPROVED },
            superAdminUser,
            client,
        );

        expect(result.status).toBe(AffiliateApplicationStatus.APPROVED);
    });

    it("rejects reviewers who are neither ADMIN nor SUPER_ADMIN", async () => {
        const { client } = makeReviewClient();
        await expect(
            AffiliateApplicationService.reviewAffiliateApplication(
                "afa1",
                { status: AffiliateApplicationStatus.APPROVED },
                { userId: "mod1", role: Role.MODERATOR, email: "mod@x.com" },
                client,
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it("prevents a user from reviewing their own application", async () => {
        const { client } = makeReviewClient({ ownApplication: true });
        await expect(
            AffiliateApplicationService.reviewAffiliateApplication(
                "afa1",
                { status: AffiliateApplicationStatus.APPROVED },
                adminUser,
                client,
            ),
        ).rejects.toThrow("own affiliate application");
    });

    it("rejects repeated/unauthorized state transitions", async () => {
        const { client } = makeReviewClient({
            application: {
                id: "afa1",
                appUserId: "app1",
                status: AffiliateApplicationStatus.APPROVED,
                appUser: { authUserId: "user1" },
            },
        });

        await expect(
            AffiliateApplicationService.reviewAffiliateApplication(
                "afa1",
                { status: AffiliateApplicationStatus.REJECTED },
                adminUser,
                client,
            ),
        ).rejects.toThrow("Cannot change affiliate application status");
    });

    it("cannot transition an application back to PENDING", async () => {
        const { client } = makeReviewClient();
        await expect(
            AffiliateApplicationService.reviewAffiliateApplication(
                "afa1",
                { status: AffiliateApplicationStatus.PENDING },
                adminUser,
                client,
            ),
        ).rejects.toThrow("back to PENDING");
    });

    it("requires a rejection reason when rejecting", async () => {
        const { client } = makeReviewClient();
        await expect(
            AffiliateApplicationService.reviewAffiliateApplication(
                "afa1",
                { status: AffiliateApplicationStatus.REJECTED },
                adminUser,
                client,
            ),
        ).rejects.toThrow("Rejection reason is required");
    });

    it("rejects with a reason and records the reviewer", async () => {
        const { client } = makeReviewClient();

        const result = await AffiliateApplicationService.reviewAffiliateApplication(
            "afa1",
            { status: AffiliateApplicationStatus.REJECTED, rejectionReason: "Did not meet criteria" },
            adminUser,
            client,
        );

        expect(result.status).toBe(AffiliateApplicationStatus.REJECTED);
        expect(result.rejectionReason).toBe("Did not meet criteria");
        expect(result.reviewedById).toBe("admin1");
    });

    it("returns NOT_FOUND for an unknown application", async () => {
        const { client } = makeReviewClient({ application: null });
        await expect(
            AffiliateApplicationService.reviewAffiliateApplication(
                "missing",
                { status: AffiliateApplicationStatus.APPROVED },
                adminUser,
                client,
            ),
        ).rejects.toMatchObject({ statusCode: 404 });
    });
});
