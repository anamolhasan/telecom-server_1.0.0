import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "../../../../generated/prisma/client";
import {
    EarningProgram,
    EarningStatus,
    ReferralApplicationStatus,
    WalletTransactionReason,
    WalletTransactionType,
} from "../../../../generated/prisma/enums";
import { ReferralService } from "./referral.service";

// Requirement: three ACTIVE referrals qualify the referrer for exactly ONE
// one-time milestone reward, and the same milestone can never pay twice. The
// reward AMOUNT is a business decision that is not defined in the codebase, so it
// is read from SystemSetting; while it is unset no reward is issued.

interface IOverrides {
    applicationStatus?: ReferralApplicationStatus | null;
    qualifyingGroups?: { userId: string }[];
    settingValue?: string | null;
    milestoneExists?: unknown;
    claimFails?: boolean;
}

const makeTx = (overrides: IOverrides = {}) => {
    const reference = {
        id: "referrer",
        authUserId: "referrerAuth",
        balance: 0,
        totalEarned: 0,
    };

    const earningsById = new Map<string, Record<string, unknown>>();

    const tx = {
        referralApplication: {
            findUnique: vi.fn().mockResolvedValue(
                overrides.applicationStatus === null
                    ? null
                    : {
                        id: "ra1",
                        appUserId: "referrer",
                        status:
                            overrides.applicationStatus ??
                            ReferralApplicationStatus.APPROVED,
                    },
            ),
        },
        appUser: {
            findMany: vi.fn().mockResolvedValue([
                { authUserId: "a" },
                { authUserId: "b" },
                { authUserId: "c" },
            ]),
            findUniqueOrThrow: vi.fn().mockResolvedValue(reference),
            update: vi.fn().mockResolvedValue({}),
        },
        order: {
            groupBy: vi.fn().mockResolvedValue(
                overrides.qualifyingGroups ?? [
                    { userId: "a" },
                    { userId: "b" },
                    { userId: "c" },
                ],
            ),
        },
        systemSetting: {
            findUnique: vi.fn().mockResolvedValue(
                overrides.settingValue === undefined || overrides.settingValue === null
                    ? null
                    : { key: "REFERRAL_MILESTONE_REWARD_AMOUNT", value: overrides.settingValue },
            ),
        },
        referralMilestoneReward: {
            findUnique: vi.fn().mockResolvedValue(overrides.milestoneExists ?? null),
            create: vi.fn(async (args: { data: Record<string, unknown> }) => {
                if (overrides.claimFails) {
                    throw Object.assign(new Error("unique"), { code: "P2002" });
                }
                return { id: "milestone-1", ...args.data };
            }),
            update: vi.fn(async (args: { data: Record<string, unknown> }) => ({
                id: "milestone-1",
                ...args.data,
            })),
        },
        earningTransaction: {
            findUnique: vi.fn(async (args: { where: Record<string, string> }) => {
                if (args.where.idempotencyKey) return null;
                return earningsById.get(args.where.id) ?? null;
            }),
            create: vi.fn(async (args: { data: Record<string, unknown> }) => {
                const row: Record<string, unknown> = { ...args.data };
                row.id = "earning-1";
                earningsById.set("earning-1", row);
                return row;
            }),
            updateMany: vi.fn(
                async (args: {
                    where: Record<string, unknown>;
                    data: Record<string, unknown>;
                }) => {
                    const row = earningsById.get(args.where.id as string);
                    if (!row || row.status !== args.where.status) {
                        return { count: 0 };
                    }
                    Object.assign(row, args.data);
                    return { count: 1 };
                },
            ),
            findUniqueOrThrow: vi.fn(async (args: { where: { id: string } }) =>
                earningsById.get(args.where.id) ?? {},
            ),
        },
        walletTransaction: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
                id: "wt-milestone",
                ...args.data,
            })),
        },
    };

    return tx as unknown as Prisma.TransactionClient & typeof tx;
};

describe("evaluateMilestoneReward", () => {
    it("does not award below the required number of active referrals", async () => {
        const tx = makeTx({
            qualifyingGroups: [{ userId: "a" }, { userId: "b" }],
            settingValue: "500",
        });

        const result = await ReferralService.evaluateMilestoneReward(tx, "referrer");

        expect(result).toBeNull();
        expect(tx.referralMilestoneReward.create).not.toHaveBeenCalled();
        expect(tx.walletTransaction.create).not.toHaveBeenCalled();
    });

    it("does not award when the application is not approved", async () => {
        const tx = makeTx({
            applicationStatus: ReferralApplicationStatus.PENDING,
            settingValue: "500",
        });

        const result = await ReferralService.evaluateMilestoneReward(tx, "referrer");

        expect(result).toBeNull();
        expect(tx.referralMilestoneReward.create).not.toHaveBeenCalled();
    });

    it("never invents a reward when the amount is not configured", async () => {
        const tx = makeTx({ settingValue: null });

        const result = await ReferralService.evaluateMilestoneReward(tx, "referrer");

        // The business amount is undefined: no milestone row and no credit.
        expect(result).toBeNull();
        expect(tx.referralMilestoneReward.create).not.toHaveBeenCalled();
        expect(tx.earningTransaction.create).not.toHaveBeenCalled();
        expect(tx.walletTransaction.create).not.toHaveBeenCalled();
    });

    it("awards one milestone and credits it once for three active referrals", async () => {
        const tx = makeTx({ settingValue: "500" });

        const result = await ReferralService.evaluateMilestoneReward(tx, "referrer");

        expect(result).toEqual({ awarded: true, amount: 500 });
        expect(tx.referralMilestoneReward.create).toHaveBeenCalledTimes(1);
        // The reward is a REFERRAL_MILESTONE credit, not a referral commission.
        expect(tx.walletTransaction.create).toHaveBeenCalledTimes(1);
        expect(tx.walletTransaction.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    userId: "referrerAuth",
                    type: WalletTransactionType.CREDIT,
                    reason: WalletTransactionReason.REFERRAL_MILESTONE,
                    amount: 500,
                }),
            }),
        );
        // The milestone row is linked to its immutable earning.
        expect(tx.referralMilestoneReward.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { appUserId: "referrer" },
                data: expect.objectContaining({
                    status: EarningStatus.AVAILABLE,
                    earningTransactionId: "earning-1",
                }),
            }),
        );
    });

    it("records the earning against the Referral program with a frozen snapshot", async () => {
        const tx = makeTx({ settingValue: "500" });

        await ReferralService.evaluateMilestoneReward(tx, "referrer");

        expect(tx.earningTransaction.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    program: EarningProgram.REFERRAL,
                    walletReason: WalletTransactionReason.REFERRAL_MILESTONE,
                    idempotencyKey: "REFERRAL_MILESTONE:referrer",
                }),
            }),
        );
    });

    it("never awards the same milestone twice", async () => {
        const tx = makeTx({
            settingValue: "500",
            milestoneExists: { id: "milestone-1", appUserId: "referrer" },
        });

        const result = await ReferralService.evaluateMilestoneReward(tx, "referrer");

        expect(result).toBeNull();
        expect(tx.referralMilestoneReward.create).not.toHaveBeenCalled();
        expect(tx.walletTransaction.create).not.toHaveBeenCalled();
    });

    it("loses a concurrent one-time claim without paying", async () => {
        const tx = makeTx({ settingValue: "500", claimFails: true });

        const result = await ReferralService.evaluateMilestoneReward(tx, "referrer");

        expect(result).toBeNull();
        expect(tx.earningTransaction.create).not.toHaveBeenCalled();
        expect(tx.walletTransaction.create).not.toHaveBeenCalled();
    });
});

describe("getMyMilestone", () => {
    it("reports progress and that the business amount is still unconfigured", async () => {
        const tx = makeTx({ settingValue: null });
        (tx.appUser as unknown as { findUnique: ReturnType<typeof vi.fn> }).findUnique =
            vi.fn().mockResolvedValue({ id: "referrer" });

        const state = await ReferralService.getMyMilestone(
            { userId: "referrerAuth", role: "USER", email: "r@x.com" } as never,
            tx,
        );

        expect(state.requiredReferralCount).toBe(3);
        expect(state.activeReferralCount).toBe(3);
        expect(state.qualified).toBe(true);
        expect(state.awarded).toBe(false);
        expect(state.configured).toBe(false);
        expect(state.amount).toBe(0);
        expect(state.settingKey).toBe(ReferralService.MILESTONE_REWARD_AMOUNT_SETTING_KEY);
    });

    it("reports the awarded amount once the milestone exists", async () => {
        const tx = makeTx({
            settingValue: "500",
            milestoneExists: {
                appUserId: "referrer",
                amount: "500.00",
                awardedAt: new Date("2026-10-10"),
            },
        });
        (tx.appUser as unknown as { findUnique: ReturnType<typeof vi.fn> }).findUnique =
            vi.fn().mockResolvedValue({ id: "referrer" });

        const state = await ReferralService.getMyMilestone(
            { userId: "referrerAuth", role: "ADMIN", email: "r@x.com" } as never,
            tx,
        );

        expect(state.awarded).toBe(true);
        expect(state.amount).toBe(500);
        expect(state.configured).toBe(true);
    });
});
