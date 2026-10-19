import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "../../../../../generated/prisma/client";
import {
    ReferralApplicationStatus,
    ReferralPromotionMethod,
    Role,
} from "../../../../../generated/prisma/enums";
import { ReferralApplicationService } from "./referralApplication.service";


describe("applyForReferralIncome (one-time application)", () => {
    const makeApplyClient = (existing: unknown) => {
        const tx = {
            referralApplication: {
                findUnique: vi.fn().mockResolvedValue(existing),
                create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
                    id: "ra-new",
                    ...args.data,
                })),
            },
        };

        return {
            client: {
                appUser: {
                    findUnique: vi.fn().mockResolvedValue({
                        id: "app1",
                        authUserId: "user1",
                        isDeleted: false,
                    }),
                },
                $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
                ...tx,
            } as unknown as Prisma.TransactionClient,
            tx,
        };
    };

    it("allows applying with zero active referred accounts", async () => {
        const { client, tx } = makeApplyClient(null);

        const result = await ReferralApplicationService.applyForReferralIncome(
            { userId: "user1", role: Role.USER, email: "u@x.com" },
            {},
            client,
        );

        expect(result.status).toBe(ReferralApplicationStatus.PENDING);
        expect(tx.referralApplication.create).toHaveBeenCalledTimes(1);
    });

    it("persists the applicant-provided referral details", async () => {
        const { client, tx } = makeApplyClient(null);

        await ReferralApplicationService.applyForReferralIncome(
            { userId: "user1", role: Role.USER, email: "u@x.com" },
            {
                promotionMethod: ReferralPromotionMethod.SOCIAL_MEDIA,
                promotionUrl: "https://example.com/promo",
                reason: "I will promote Rizqiva on my social channels.",
                termsAccepted: true,
            },
            client,
        );

        expect(tx.referralApplication.create).toHaveBeenCalledWith({
            data: {
                appUserId: "app1",
                status: ReferralApplicationStatus.PENDING,
                promotionMethod: ReferralPromotionMethod.SOCIAL_MEDIA,
                promotionUrl: "https://example.com/promo",
                reason: "I will promote Rizqiva on my social channels.",
                termsAccepted: true,
            },
        });
    });

    it("blocks a second (duplicate) application", async () => {
        const { client } = makeApplyClient({
            id: "ra-existing",
            appUserId: "app1",
            status: ReferralApplicationStatus.PENDING,
        });

        await expect(
            ReferralApplicationService.applyForReferralIncome(
                { userId: "user1", role: Role.USER, email: "u@x.com" },
                {},
                client,
            ),
        ).rejects.toThrow("already submitted");
    });
});

describe("getMyReferral (own application only)", () => {
    interface IReadOverrides {
        appUser?: {
            id: string;
            referralCode?: string;
            referralIncomeEligible: boolean;
            referralApplication: unknown;
            referrer: unknown;
        } | null;
        application?: unknown;
        referrals?: { id: string; createdAt: string; authUser: { name: string; email: string } }[];
    }

    const makeReadClient = (overrides: IReadOverrides = {}) => {
        const client = {
            appUser: {
                findUnique: vi.fn().mockResolvedValue(
                    overrides.appUser === undefined
                        ? {
                              id: "app1",
                              referralCode: "CODE1234",
                              referralIncomeEligible: true,
                              referralApplication: {
                                  id: "ra1",
                                  appUserId: "app1",
                                  status: ReferralApplicationStatus.PENDING,
                              },
                              referrer: null,
                          }
                        : overrides.appUser,
                ),
                findMany: vi.fn().mockResolvedValue(overrides.referrals ?? []),
            },
            referralApplication: {
                findUnique: vi.fn().mockResolvedValue(
                    overrides.application === undefined
                        ? {
                              id: "ra1",
                              appUserId: "app1",
                              status: ReferralApplicationStatus.PENDING,
                          }
                        : overrides.application,
                ),
            },
            order: {
                groupBy: vi.fn().mockResolvedValue([]),
            },
        };

        return client as unknown as Prisma.TransactionClient;
    };

    it("scopes the lookup to the authenticated user and returns their application", async () => {
        const client = makeReadClient();

        const result = await ReferralApplicationService.getMyReferral(
            { userId: "user1", role: Role.USER, email: "u@x.com" },
            client,
        );

        expect(client.appUser.findUnique).toHaveBeenCalledWith(
            expect.objectContaining({ where: { authUserId: "user1" } }),
        );
        expect(result.application).toMatchObject({ id: "ra1", appUserId: "app1" });
        expect(result.referralCode).toBe("CODE1234");
    });

    it("returns a null application when the user has not applied yet", async () => {
        const client = makeReadClient({
            appUser: {
                id: "app1",
                referralIncomeEligible: false,
                referralApplication: null,
                referrer: null,
            },
            application: null,
        });

        const result = await ReferralApplicationService.getMyReferral(
            { userId: "user1", role: Role.USER, email: "u@x.com" },
            client,
        );

        expect(result.application).toBeNull();
        expect(result.eligibility.approved).toBe(false);
    });

    it("throws NOT_FOUND when the caller has no app user record", async () => {
        const client = makeReadClient({ appUser: null });

        await expect(
            ReferralApplicationService.getMyReferral(
                { userId: "ghost", role: Role.USER, email: "g@x.com" },
                client,
            ),
        ).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe("reviewApplication (admin review)", () => {
    const build = (applicationStatus: ReferralApplicationStatus, appUserId = "buyer1") => {
        const tx = {
            referralApplication: {
                update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => ({
                    id: args.where.id,
                    ...args.data,
                })),
                findUnique: vi.fn().mockResolvedValue({
                    id: "app1",
                    appUserId: "approverApp",
                    status: applicationStatus,
                }),
            },
            appUser: {
                findMany: vi.fn().mockResolvedValue([]),
                update: vi.fn().mockResolvedValue({}),
            },
            order: {
                groupBy: vi.fn().mockResolvedValue([]),
            },
        };

        const client = {
            referralApplication: {
                findUnique: vi.fn().mockResolvedValue({
                    id: "app1",
                    status: applicationStatus,
                    appUserId: "approvedUserApp",
                    appUser: { authUserId: appUserId },
                }),
            },
            appUser: {
                findMany: vi.fn().mockResolvedValue([]),
                update: vi.fn().mockResolvedValue({}),
            },
            order: {
                groupBy: vi.fn().mockResolvedValue([]),
            },
            $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
        } as unknown as Prisma.TransactionClient;

        return { client, tx };
    };

    it("approves a PENDING application and records the reviewer + review time", async () => {
        const { client } = build(ReferralApplicationStatus.PENDING);
        const reviewedAt = new Date("2026-10-09T12:00:00.000Z");
        vi.useFakeTimers();
        vi.setSystemTime(reviewedAt);

        const result = await ReferralApplicationService.reviewApplication(
            "app1",
            { status: ReferralApplicationStatus.APPROVED },
            { userId: "admin1", role: Role.ADMIN, email: "admin@x.com" },
            client,
        );

        expect(result.status).toBe(ReferralApplicationStatus.APPROVED);
        expect(result.reviewedById).toBe("admin1");
        expect(result.reviewedAt).toEqual(reviewedAt);
        expect(result.rejectionReason).toBeNull();

        vi.useRealTimers();
    });

    it("prevents a user from reviewing their own application", async () => {
        const { client } = build(ReferralApplicationStatus.PENDING, "admin1");

        await expect(
            ReferralApplicationService.reviewApplication(
                "app1",
                { status: ReferralApplicationStatus.APPROVED },
                { userId: "admin1", role: Role.ADMIN, email: "admin@x.com" },
                client,
            ),
        ).rejects.toThrow("own referral application");
    });

    it("rejects repeated/unauthorized state transitions", async () => {
        const { client } = build(ReferralApplicationStatus.APPROVED);

        await expect(
            ReferralApplicationService.reviewApplication(
                "app1",
                { status: ReferralApplicationStatus.REJECTED },
                { userId: "admin1", role: Role.ADMIN, email: "admin@x.com" },
                client,
            ),
        ).rejects.toThrow("Cannot change referral application status");
    });

    it("requires a rejection reason when rejecting", async () => {
        const { client } = build(ReferralApplicationStatus.PENDING);

        await expect(
            ReferralApplicationService.reviewApplication(
                "app1",
                { status: ReferralApplicationStatus.REJECTED },
                { userId: "admin1", role: Role.ADMIN, email: "admin@x.com" },
                client,
            ),
        ).rejects.toThrow("Rejection reason is required");
    });

    it("rejects with a reason and records the reviewer", async () => {
        const { client } = build(ReferralApplicationStatus.PENDING);
        const result = await ReferralApplicationService.reviewApplication(
            "app1",
            { status: ReferralApplicationStatus.REJECTED, rejectionReason: "Did not meet criteria" },
            { userId: "admin1", role: Role.ADMIN, email: "admin@x.com" },
            client,
        );

        expect(result.status).toBe(ReferralApplicationStatus.REJECTED);
        expect(result.rejectionReason).toBe("Did not meet criteria");
        expect(result.reviewedById).toBe("admin1");
    });
});
