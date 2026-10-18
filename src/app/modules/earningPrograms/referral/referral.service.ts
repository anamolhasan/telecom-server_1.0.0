import status from "http-status";
import { Prisma } from "../../../../generated/prisma/client";
import {
    EarningProgram,
    EarningRuleScope,
    EarningRuleType,
    EarningStatus,
    OrderStatus,
    PaymentStatus,
    ReferralApplicationStatus,
    WalletTransactionReason,
} from "../../../../generated/prisma/enums";
import {
    REFERRAL_ACTIVE_MONTHS,
    REFERRAL_MIN_ACTIVE_REFERRALS,
} from "../../../constants/telecom.constant";
import AppError from "../../../errorHelpers/AppError";
import { IRequestUser } from "../../../interfaces/requestUser.interface";
import { prisma } from "../../../lib/prisma";
import { toMoneyCents, toMoneyNumber } from "../../ecommerce/ecommerce.utils";
import { referralMilestoneIdempotencyKey } from "../../earning/earning.rule";
import { EarningService } from "../../earning/earning.service";
import { SettingService } from "../../setting/setting.service";
import {
    IPartnerReferralDashboard,
    IDefaultReferralCode,
    IReferralMilestoneConfig,
    IReferralMilestoneState,
} from "./referral.interface";
import {
    computeReferralEligibility,
    IReferralEligibility,
    subtractMonths,
} from "./referral.rule";


// Resolve which referred accounts are ACTIVE: at least one qualifying offer purchase
// (COMPLETED + PAID) inside the rolling previous N months. Grouped by user so a referred
// account is counted once regardless of how many qualifying purchases it has.
const getQualifyingReferredAuthUserIds = async (
    client: Prisma.TransactionClient | typeof prisma,
    referredAuthUserIds: string[],
    now: Date = new Date(),
): Promise<Set<string>> => {
    if (referredAuthUserIds.length === 0) {
        return new Set<string>();
    }

    const cutoff = subtractMonths(now, REFERRAL_ACTIVE_MONTHS);

    const qualifiedByUser = await client.order.groupBy({
        by: ["userId"],
        where: {
            userId: { in: referredAuthUserIds },
            status: OrderStatus.COMPLETED,
            paymentStatus: PaymentStatus.PAID,
            completedAt: { gte: cutoff },
        },
    });

    return new Set(qualifiedByUser.map((row) => row.userId));
};

// Count distinct active referred accounts for a referrer.
export const getActiveReferredCount = async (
    tx: Prisma.TransactionClient,
    appUserId: string,
    now: Date = new Date(),
): Promise<number> => {
    const referredUsers = await tx.appUser.findMany({
        where: { referredBy: appUserId, isDeleted: false },
        select: { authUserId: true },
    });

    const activeAuthUserIds = await getQualifyingReferredAuthUserIds(
        tx,
        referredUsers.map((user) => user.authUserId),
        now,
    );

    return activeAuthUserIds.size;
};

// Eligibility is always derived from live data (never trusted from clients).
const getReferralStatus = async (
    client: Prisma.TransactionClient | typeof prisma,
    appUserId: string,
    now: Date = new Date(),
): Promise<IReferralEligibility> => {
    const [application, activeReferredCount] = await Promise.all([
        client.referralApplication.findUnique({ where: { appUserId } }),
        getActiveReferredCount(client, appUserId, now),
    ]);

    return computeReferralEligibility(application?.status ?? null, activeReferredCount);
};

// Persisted cache so the scheduler and UI can observe suspension/reactivation without
// trusting stale state for financial decisions (grantReferralIncome re-derives live).
const refreshReferralIncomeCache = async (
    client: Prisma.TransactionClient | typeof prisma,
    appUserId: string,
    now: Date = new Date(),
): Promise<IReferralEligibility> => {
    const status = await getReferralStatus(client, appUserId, now);

    await client.appUser.update({
        where: { id: appUserId },
        data: { referralIncomeEligible: status.eligible },
    });

    return status;
};

// Public registration prefill: reads the persisted system-wide default referral code so
// the registration form can prefill when no referral URL is given. The setting module owns
// the value and resolves eligibility using the same rules as registration.
const getDefaultReferralCode = async (
    client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<IDefaultReferralCode> => {
    const setting = await SettingService.getDefaultReferralSetting(client);
    return { referralCode: setting.referralCode };
};

// The Referral programme dashboard for the caller: their own referral code, their
// own referred accounts and the status of their own application. Reachable by ANY
// authenticated account — sharing a referral link is programme participation, not
// a reward decision (see referral.route.ts), so an approved application must not
// be a precondition for reading it. Nothing about another participant is
// reachable, and reward eligibility is derived separately by getReferralStatus,
// which still requires the APPROVED application.
const getPartnerReferralDashboard = async (
    user: IRequestUser,
    client: Prisma.TransactionClient | typeof prisma = prisma,
    now: Date = new Date(),
): Promise<IPartnerReferralDashboard> => {
    const appUser = await client.appUser.findUnique({
        where: { authUserId: user.userId },
        include: {
            referralApplication: {
                select: { status: true },
            },
        },
    });

    if (!appUser) {
        throw new AppError(status.NOT_FOUND, "App user not found");
    }

    const application = appUser.referralApplication;

    const referredAppUsers = await client.appUser.findMany({
        where: { referredBy: appUser.id, isDeleted: false },
        select: {
            id: true,
            authUserId: true,
            createdAt: true,
            authUser: { select: { name: true, email: true } },
        },
        orderBy: { createdAt: "desc" },
    });

    const activeAuthUserIds = await getQualifyingReferredAuthUserIds(
        client,
        referredAppUsers.map((referred) => referred.authUserId),
        now,
    );

    const referrals = referredAppUsers.map((referred) => ({
        id: referred.id,
        name: referred.authUser.name,
        email: referred.authUser.email,
        joinedAt: referred.createdAt,
        isActive: activeAuthUserIds.has(referred.authUserId),
    }));

    return {
        referralCode: appUser.referralCode,
        applicationStatus: application?.status ?? null,
        totalReferredCount: referrals.length,
        activeReferredCount: referrals.filter((referral) => referral.isActive).length,
        targetActiveReferrals: REFERRAL_MIN_ACTIVE_REFERRALS,
        referralIncomeEligible: appUser.referralIncomeEligible,
        referrals,
    };
};

const findAppUserForUser = async (userId: string) =>
    prisma.appUser.findUnique({ where: { authUserId: userId } });

const recalculateReferrerEligibilityForOrder = async (
    orderId: string,
    tx?: Prisma.TransactionClient,
) => {
    const client = tx ?? prisma;

    const order = await client.order.findUnique({
        where: { id: orderId },
        include: { user: { include: { appUser: true } } },
    });

    const buyerAppUser = order?.user?.appUser;

    if (!buyerAppUser?.referredBy) {
        return null;
    }

    return refreshReferralIncomeCache(client, buyerAppUser.referredBy);
};

const recalculateEligibilityForUser = async (userId: string) => {
    const appUser = await findAppUserForUser(userId);

    if (!appUser) {
        throw new AppError(status.NOT_FOUND, "App user not found");
    }

    return refreshReferralIncomeCache(prisma, appUser.id);
};

// Rolling 6-month reconciliation: recompute all approved applicants so that referred
// accounts whose qualifying purchases moved outside the window are reflected even when
// no new event triggered a recalculation.
const reconcileAllReferralEligibility = async () => {
    const approvedApplications = await prisma.referralApplication.findMany({
        where: { status: ReferralApplicationStatus.APPROVED },
        select: { appUserId: true },
    });

    let eligible = 0;

    for (const application of approvedApplications) {
        const status = await refreshReferralIncomeCache(prisma, application.appUserId);
        if (status.eligible) {
            eligible++;
        }
    }

    return { evaluated: approvedApplications.length, eligible };
};

// ─────────────────────────────────────────────────────────────────────────────
// One-time referral milestone reward
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ BUSINESS DECISION REQUIRED: the reward AMOUNT is not defined anywhere in the
// codebase or the product spec. It is therefore read from SystemSetting
// (`REFERRAL_MILESTONE_REWARD_AMOUNT`) instead of being invented here. While the
// setting is absent or not a positive number, `configured` is false and no reward
// is issued — the qualifier is still reported so the decision is visible.
export const MILESTONE_REWARD_AMOUNT_SETTING_KEY =
    "REFERRAL_MILESTONE_REWARD_AMOUNT";

const getMilestoneConfig = async (
    client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<IReferralMilestoneConfig> => {
    const setting = await client.systemSetting.findUnique({
        where: { key: MILESTONE_REWARD_AMOUNT_SETTING_KEY },
    });

    const parsed = Number(setting?.value?.trim() ?? "");
    const amount = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;

    return {
        amount,
        currency: "bdt",
        requiredReferralCount: REFERRAL_MIN_ACTIVE_REFERRALS,
        configured: amount > 0,
        settingKey: MILESTONE_REWARD_AMOUNT_SETTING_KEY,
    };
};

// Award the one-time milestone reward when a referrer reaches the required number
// of ACTIVE referrals.
//
// Duplicate protection is layered:
//   1. `ReferralMilestoneReward.appUserId` is UNIQUE — the claim row is inserted
//      first, so a concurrent or repeated evaluation loses the insert and never
//      pays a second time.
//   2. The earning ledger's `idempotencyKey` is derived from the beneficiary only.
// Either layer alone would be sufficient; together they make a double reward
// impossible even across processes.
const evaluateMilestoneReward = async (
    tx: Prisma.TransactionClient,
    referrerAppUserId: string,
    now: Date = new Date(),
): Promise<{ awarded: boolean; amount: number } | null> => {
    const existing = await tx.referralMilestoneReward.findUnique({
        where: { appUserId: referrerAppUserId },
    });

    if (existing) {
        return null;
    }

    const [config, referralStatus] = await Promise.all([
        getMilestoneConfig(tx),
        getReferralStatus(tx, referrerAppUserId, now),
    ]);

    // Requires both an APPROVED Referral application and enough active referrals.
    if (!referralStatus.eligible) {
        return null;
    }

    if (!config.configured) {
        // The business amount is not configured: never invent a financial value.
        return null;
    }

    const referrer = await tx.appUser.findUniqueOrThrow({
        where: { id: referrerAppUserId },
    });

    // Claim first: this insert is the one-time gate.
    try {
        await tx.referralMilestoneReward.create({
            data: {
                appUserId: referrerAppUserId,
                status: EarningStatus.PENDING,
                amount: config.amount.toFixed(2),
                currency: config.currency,
                qualifiedReferralCount: referralStatus.activeReferredCount,
                requiredReferralCount: config.requiredReferralCount,
                configKey: config.settingKey,
            },
        });
    } catch (error) {
        if ((error as { code?: string }).code === "P2002") {
            // Another evaluation won the one-time claim. Nothing was credited.
            return null;
        }
        throw error;
    }

    const earning = await EarningService.createEarning(tx, {
        program: EarningProgram.REFERRAL,
        appUserId: referrerAppUserId,
        userId: referrer.authUserId,
        amountCents: toMoneyCents(config.amount),
        baseAmountCents: 0,
        walletReason: WalletTransactionReason.REFERRAL_MILESTONE,
        rule: {
            scope: EarningRuleScope.GLOBAL,
            ruleType: EarningRuleType.FIXED,
            value: config.amount,
            refId: config.settingKey,
        },
        idempotencyKey: referralMilestoneIdempotencyKey(referrerAppUserId),
        description: `One-time referral milestone reward (${referralStatus.activeReferredCount} active referrals)`,
    });

    await tx.referralMilestoneReward.update({
        where: { appUserId: referrerAppUserId },
        data: {
            status: EarningStatus.AVAILABLE,
            availableAt: new Date(),
            earningTransactionId: earning.id,
            ruleSnapshot: {
                settingKey: config.settingKey,
                amount: config.amount.toFixed(2),
                currency: config.currency,
                requiredReferralCount: config.requiredReferralCount,
                qualifiedReferralCount: referralStatus.activeReferredCount,
            } as unknown as Prisma.InputJsonValue,
        },
    });

    return { awarded: true, amount: config.amount };
};

// The caller's own milestone state: how close they are, whether it was awarded and
// (when not configured) that the business amount is still pending. No other
// referrer's data is reachable.
const getMyMilestone = async (
    user: IRequestUser,
    client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<IReferralMilestoneState> => {
    const appUser = await client.appUser.findUnique({
        where: { authUserId: user.userId },
        select: { id: true },
    });

    if (!appUser) {
        throw new AppError(status.NOT_FOUND, "App user not found");
    }

    const [config, milestone, referralStatus] = await Promise.all([
        getMilestoneConfig(client),
        client.referralMilestoneReward.findUnique({
            where: { appUserId: appUser.id },
        }),
        getReferralStatus(client, appUser.id),
    ]);

    return {
        requiredReferralCount: config.requiredReferralCount,
        activeReferralCount: referralStatus.activeReferredCount,
        qualified:
            referralStatus.activeReferredCount >= config.requiredReferralCount,
        awarded: Boolean(milestone),
        awardedAt: milestone?.awardedAt ?? null,
        amount: milestone ? toMoneyNumber(milestone.amount) : config.amount,
        currency: config.currency,
        configured: config.configured,
        settingKey: config.settingKey,
    };
};

export const ReferralService = {
    getDefaultReferralCode,
    getPartnerReferralDashboard,
    recalculateReferrerEligibilityForOrder,
    recalculateEligibilityForUser,
    reconcileAllReferralEligibility,
    getReferralStatus,
    getActiveReferredCount,
    refreshReferralIncomeCache,
    MILESTONE_REWARD_AMOUNT_SETTING_KEY,
    getMilestoneConfig,
    evaluateMilestoneReward,
    getMyMilestone,
};