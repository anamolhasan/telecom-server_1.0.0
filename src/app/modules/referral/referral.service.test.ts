import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "../../../generated/prisma/client";
import {
    ReferralApplicationStatus,
    Role,
    WalletTransactionReason,
    WalletTransactionType,
} from "../../../generated/prisma/enums";
import { applyWalletTransaction } from "../wallet/wallet.utils";
import { ReferralIncomeService } from "./referral.income";
import { ReferralService } from "./referral.service";


interface IReferralTxOverrides {
    application?: { id: string; appUserId: string; status: ReferralApplicationStatus } | null;
    referredUsers?: { authUserId: string }[];
    qualifyingGroups?: { userId: string }[];
    referrer?: { id: string; authUserId: string; balance: number; totalEarned: number };
    existing?: { id: string; orderId: string; reason: WalletTransactionReason } | null;
}

const GRANT_APPROVED = {
    id: "ra1",
    appUserId: "referrer",
    status: ReferralApplicationStatus.APPROVED,
};

const makeReferralTx = (overrides: IReferralTxOverrides = {}): Prisma.TransactionClient => {
    const tx = {
        referralApplication: {
            findUnique: vi.fn().mockResolvedValue(
                overrides.application === undefined ? GRANT_APPROVED : overrides.application,
            ),
        },
        appUser: {
            findMany: vi.fn().mockResolvedValue(
                overrides.referredUsers ?? [
                    { authUserId: "a" },
                    { authUserId: "b" },
                    { authUserId: "c" },
                ],
            ),
            findUniqueOrThrow: vi.fn().mockResolvedValue(
                overrides.referrer ?? {
                    id: "referrer",
                    authUserId: "referrerAuth",
                    balance: 0,
                    totalEarned: 0,
                },
            ),
            update: vi.fn().mockResolvedValue({}),
        },
        order: {
            groupBy: vi.fn().mockResolvedValue(
                overrides.qualifyingGroups ?? [{ userId: "a" }, { userId: "b" }, { userId: "c" }],
            ),
        },
        walletTransaction: {
            findFirst: vi.fn().mockResolvedValue(overrides.existing ?? null),
            create: vi.fn(async (args: { data: { amount: number; balanceAfter: number } }) => ({
                id: "wt1",
                ...args.data,
            })),
        },
    };

    return tx as unknown as Prisma.TransactionClient;
};


describe("getActiveReferredCount", () => {
    it("counts each distinct referred user only once", async () => {
        const tx = makeReferralTx({
            referredUsers: [{ authUserId: "a" }, { authUserId: "b" }, { authUserId: "c" }],
            qualifyingGroups: [{ userId: "a" }, { userId: "b" }],
        });

        const count = await ReferralService.getActiveReferredCount(tx, "referrer");
        expect(count).toBe(2);
    });

    it("returns 1 even when one user has many qualifying purchases (grouped by user)", async () => {
        const tx = makeReferralTx({
            referredUsers: [{ authUserId: "a" }],
            qualifyingGroups: [{ userId: "a" }],
        });

        const count = await ReferralService.getActiveReferredCount(tx, "referrer");
        expect(count).toBe(1);
    });

    it("short-circuits to 0 with no referred users", async () => {
        const tx = makeReferralTx({ referredUsers: [] });
        const count = await ReferralService.getActiveReferredCount(tx, "referrer");
        expect(count).toBe(0);
    });
});

describe("grantReferralIncome", () => {
    it("does not credit a user who has never applied, even with 3+ active referred accounts", async () => {
        const tx = makeReferralTx({ application: null });

        const result = await ReferralIncomeService.grantReferralIncome(tx, {
            appUserId: "referrer",
            orderId: "order1",
            amount: 100,
        });

        expect(result).toBeNull();
        expect(tx.walletTransaction.create).not.toHaveBeenCalled();
    });

    it("does not credit an unapproved (PENDING/REJECTED) user", async () => {
        const pending = makeReferralTx({
            application: { id: "ra1", appUserId: "referrer", status: ReferralApplicationStatus.PENDING },
        });
        const rejected = makeReferralTx({
            application: { id: "ra1", appUserId: "referrer", status: ReferralApplicationStatus.REJECTED },
        });

        expect(
            await ReferralIncomeService.grantReferralIncome(pending, {
                appUserId: "referrer",
                orderId: "order1",
                amount: 100,
            }),
        ).toBeNull();
        expect(
            await ReferralIncomeService.grantReferralIncome(rejected, {
                appUserId: "referrer",
                orderId: "order1",
                amount: 100,
            }),
        ).toBeNull();
        expect(pending.walletTransaction.create).not.toHaveBeenCalled();
        expect(rejected.walletTransaction.create).not.toHaveBeenCalled();
    });

    it("enables income for an approved user with 3 active referred accounts", async () => {
        const tx = makeReferralTx();

        const result = await ReferralIncomeService.grantReferralIncome(tx, {
            appUserId: "referrer",
            orderId: "order1",
            amount: 100,
        });

        expect(result).not.toBeNull();
        expect(result?.amount).toBe(100);
        expect(result?.reason).toBe(WalletTransactionReason.REFERRAL_INCOME);
        expect(result?.type).toBe(WalletTransactionType.CREDIT);
        expect(tx.walletTransaction.create).toHaveBeenCalledTimes(1);
    });

    it("suspends income when active referred accounts fall from 3 to 2", async () => {
        const tx = makeReferralTx({
            qualifyingGroups: [{ userId: "a" }, { userId: "b" }],
        });

        const result = await ReferralIncomeService.grantReferralIncome(tx, {
            appUserId: "referrer",
            orderId: "order1",
            amount: 100,
        });

        expect(result).toBeNull();
        expect(tx.walletTransaction.create).not.toHaveBeenCalled();
    });

    it("restores income when active referred accounts rise from 2 to 3", async () => {
        const suspended = makeReferralTx({ qualifyingGroups: [{ userId: "a" }, { userId: "b" }] });
        expect(
            await ReferralIncomeService.grantReferralIncome(suspended, {
                appUserId: "referrer",
                orderId: "order1",
                amount: 100,
            }),
        ).toBeNull();

        const restored = makeReferralTx();
        expect(
            await ReferralIncomeService.grantReferralIncome(restored, {
                appUserId: "referrer",
                orderId: "order1",
                amount: 100,
            }),
        ).not.toBeNull();
    });

    it("is idempotent: a duplicate attempt returns the existing ledger entry and creates nothing new", async () => {
        const existing = {
            id: "wt-existing",
            orderId: "order1",
            reason: WalletTransactionReason.REFERRAL_INCOME,
        };
        const tx = makeReferralTx({ existing });

        const result = await ReferralIncomeService.grantReferralIncome(tx, {
            appUserId: "referrer",
            orderId: "order1",
            amount: 100,
        });

        expect(result).toBe(existing);
        expect(tx.walletTransaction.create).not.toHaveBeenCalled();
    });
});

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

        const result = await ReferralService.applyForReferralIncome(
            { userId: "user1", role: Role.USER, email: "u@x.com" },
            client,
        );

        expect(result.status).toBe(ReferralApplicationStatus.PENDING);
        expect(tx.referralApplication.create).toHaveBeenCalledTimes(1);
    });

    it("blocks a second (duplicate) application", async () => {
        const { client } = makeApplyClient({
            id: "ra-existing",
            appUserId: "app1",
            status: ReferralApplicationStatus.PENDING,
        });

        await expect(
            ReferralService.applyForReferralIncome(
                { userId: "user1", role: Role.USER, email: "u@x.com" },
                client,
            ),
        ).rejects.toThrow("already submitted");
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

        const result = await ReferralService.reviewApplication(
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
            ReferralService.reviewApplication(
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
            ReferralService.reviewApplication(
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
            ReferralService.reviewApplication(
                "app1",
                { status: ReferralApplicationStatus.REJECTED },
                { userId: "admin1", role: Role.ADMIN, email: "admin@x.com" },
                client,
            ),
        ).rejects.toThrow("Rejection reason is required");
    });

    it("rejects with a reason and records the reviewer", async () => {
        const { client } = build(ReferralApplicationStatus.PENDING);
        const result = await ReferralService.reviewApplication(
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

describe("recalculateReferrerEligibilityForOrder", () => {
    it("does nothing when the buyer has no referrer", async () => {
        const tx = {
            order: {
                findUnique: vi.fn().mockResolvedValue({
                    id: "order1",
                    user: { appUser: null },
                }),
            },
        } as unknown as Prisma.TransactionClient;

        const result = await ReferralService.recalculateReferrerEligibilityForOrder("order1", tx);
        expect(result).toBeNull();
    });

    it("recomputes the referrer eligibility when the buyer has a referrer", async () => {
        const tx = makeReferralTx({
            referredUsers: [{ authUserId: "a" }, { authUserId: "b" }, { authUserId: "c" }],
            qualifyingGroups: [{ userId: "a" }, { userId: "b" }, { userId: "c" }],
        });
        (tx.order as unknown as { findUnique: ReturnType<typeof vi.fn> }).findUnique = vi.fn().mockResolvedValue({
            id: "order1",
            user: { appUser: { referredBy: "referrer" } },
        });

        const result = await ReferralService.recalculateReferrerEligibilityForOrder("order1", tx);
        expect(result?.eligible).toBe(true);
    });
});

describe("offer-selling income is separate from Referral Income", () => {
    it("a suspended referrer still receives COMMISSION credits (unaffected by referral eligibility)", async () => {
        const tx = {
            appUser: {
                findUniqueOrThrow: vi.fn().mockResolvedValue({
                    id: "referrer",
                    authUserId: "referrerAuth",
                    balance: 0,
                    totalEarned: 0,
                }),
                update: vi.fn().mockResolvedValue({}),
            },
            walletTransaction: {
                create: vi.fn(async (args: { data: { amount: number; balanceAfter: number } }) => ({
                    id: "wt-c",
                    ...args.data,
                })),
            },
        } as unknown as Prisma.TransactionClient;

        const ledger = await applyWalletTransaction(tx, {
            userId: "referrerAuth",
            amount: 100,
            type: WalletTransactionType.CREDIT,
            reason: WalletTransactionReason.COMMISSION,
            description: "Commission for order X",
        });

        expect(ledger.reason).toBe(WalletTransactionReason.COMMISSION);
        expect(ledger.balanceAfter).toBe(100);
        expect(tx.walletTransaction.create).toHaveBeenCalledTimes(1);
    });

    it("rejects (does not create) REFERRAL_INCOME while suspended", async () => {
        const tx = makeReferralTx({
            qualifyingGroups: [{ userId: "a" }, { userId: "b" }],
        });

        const result = await ReferralIncomeService.grantReferralIncome(tx, {
            appUserId: "referrer",
            orderId: "order1",
            amount: 100,
        });

        expect(result).toBeNull();
        expect(tx.walletTransaction.create).not.toHaveBeenCalled();
    });
});