import status from "http-status";
import { Prisma, ReferralApplication } from "../../../generated/prisma/client";
import {
    OrderStatus,
    PaymentStatus,
    ReferralApplicationStatus,
} from "../../../generated/prisma/enums";
import {
    REFERRAL_ACTIVE_MONTHS,
    REFERRAL_MIN_ACTIVE_REFERRALS,
} from "../../constants/telecom.constant";
import AppError from "../../errorHelpers/AppError";
import { IQueryParams, PrismaModelDelegate } from "../../interfaces/query.interface";
import { IRequestUser } from "../../interfaces/requestUser.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { SettingService } from "../setting/setting.service";
import {
    IPartnerReferralDashboard,
    IReviewReferralApplicationPayload,
    ISubmitReferralApplicationPayload,
    IDefaultReferralCode,
} from "./referral.interface";
import {
    computeReferralEligibility,
    IReferralEligibility,
    subtractMonths,
} from "./referral.rule";


const APPLICATION_STATUS_TRANSITIONS: Record<ReferralApplicationStatus, ReferralApplicationStatus[]> = {
    [ReferralApplicationStatus.PENDING]: [
        ReferralApplicationStatus.APPROVED,
        ReferralApplicationStatus.REJECTED,
    ],
    [ReferralApplicationStatus.APPROVED]: [],
    [ReferralApplicationStatus.REJECTED]: [],
};

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

const applyForReferralIncome = async (
    user: IRequestUser,
    payload: ISubmitReferralApplicationPayload = {},
    client: Prisma.TransactionClient = prisma,
) => {
    const appUser = await client.appUser.findUnique({
        where: { authUserId: user.userId },
    });

    if (!appUser) {
        throw new AppError(status.NOT_FOUND, "App user not found");
    }

    if (appUser.isDeleted) {
        throw new AppError(status.BAD_REQUEST, "App user is deleted");
    }

    return client.$transaction(async (tx) => {
        const existing = await tx.referralApplication.findUnique({
            where: { appUserId: appUser.id },
        });

        if (existing) {
            throw new AppError(
                status.BAD_REQUEST,
                "Referral income application already submitted. Only one application is allowed.",
            );
        }

        return tx.referralApplication.create({
            data: {
                appUserId: appUser.id,
                status: ReferralApplicationStatus.PENDING,
                promotionMethod: payload.promotionMethod ?? null,
                promotionUrl: payload.promotionUrl?.trim() || null,
                reason: payload.reason?.trim() || null,
                termsAccepted: payload.termsAccepted ?? false,
            },
        });
    });
};

const getMyReferral = async (
    user: IRequestUser,
    client: Prisma.TransactionClient = prisma,
) => {
    const appUser = await client.appUser.findUnique({
        where: { authUserId: user.userId },
        include: {
            referralApplication: true,
            referrer: {
                include: {
                    authUser: { select: { name: true, email: true } },
                },
            },
        },
    });

    if (!appUser) {
        throw new AppError(status.NOT_FOUND, "App user not found");
    }

    const eligibilityStatus = await getReferralStatus(client, appUser.id);

    const referrals = await client.appUser.findMany({
        where: { referredBy: appUser.id, isDeleted: false },
        select: {
            id: true,
            createdAt: true,
            authUser: { select: { name: true, email: true } },
        },
        orderBy: { createdAt: "desc" },
    });

    return {
        application: appUser.referralApplication,
        referrer: appUser.referrer,
        referrals,
        referralCode: appUser.referralCode,
        eligibility: {
            approved: eligibilityStatus.approved,
            activeReferredCount: eligibilityStatus.activeReferredCount,
            eligible: eligibilityStatus.eligible,
        },
        referralIncomeEligible: appUser.referralIncomeEligible,
    };
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

// Read-only MVP tracking for an approved Referral Partner. Every user owns a
// unique referral code (AppUser.referralCode); the partner view additionally
// reports referral activity for that code.
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

    if (!application || application.status !== ReferralApplicationStatus.APPROVED) {
        throw new AppError(
            status.FORBIDDEN,
            "Referral partner access requires an approved referral application.",
        );
    }

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
        applicationStatus: application.status,
        totalReferredCount: referrals.length,
        activeReferredCount: referrals.filter((referral) => referral.isActive).length,
        targetActiveReferrals: REFERRAL_MIN_ACTIVE_REFERRALS,
        referralIncomeEligible: appUser.referralIncomeEligible,
        referrals,
    };
};

const getAllApplications = async (query: IQueryParams) => {
    const queryBuilder = new QueryBuilder<ReferralApplication>(
        prisma.referralApplication as unknown as PrismaModelDelegate,
        query,
        {
            searchableFields: ["appUser.authUser.name", "appUser.authUser.email"],
            filterableFields: ["status", "appUserId"],
        },
    );

    return queryBuilder
        .search()
        .filter()
        .include({
            appUser: {
                include: {
                    authUser: { select: { name: true, email: true } },
                },
            },
            reviewedBy: { select: { name: true, email: true } },
        })
        .sort()
        .paginate()
        .fields()
        .execute();
};

const reviewApplication = async (
    applicationId: string,
    payload: IReviewReferralApplicationPayload,
    adminUser: IRequestUser,
    client: Prisma.TransactionClient = prisma,
) => {
    if (payload.status === ReferralApplicationStatus.PENDING) {
        throw new AppError(status.BAD_REQUEST, "Cannot transition an application back to PENDING");
    }

    const application = await client.referralApplication.findUnique({
        where: { id: applicationId },
        include: { appUser: true },
    });

    if (!application) {
        throw new AppError(status.NOT_FOUND, "Referral application not found");
    }

    if (application.appUser.authUserId === adminUser.userId) {
        throw new AppError(status.FORBIDDEN, "You cannot review your own referral application");
    }

    const allowed = APPLICATION_STATUS_TRANSITIONS[application.status];

    if (!allowed.includes(payload.status)) {
        throw new AppError(
            status.BAD_REQUEST,
            `Cannot change referral application status from ${application.status} to ${payload.status}`,
        );
    }

    if (payload.status === ReferralApplicationStatus.REJECTED) {
        if (!payload.rejectionReason || payload.rejectionReason.trim() === "") {
            throw new AppError(status.BAD_REQUEST, "Rejection reason is required when rejecting");
        }
    }

    return client.$transaction(async (tx) => {
        const updated = await tx.referralApplication.update({
            where: { id: applicationId },
            data: {
                status: payload.status,
                rejectionReason:
                    payload.status === ReferralApplicationStatus.REJECTED
                        ? payload.rejectionReason
                        : null,
                reviewedById: adminUser.userId,
                reviewedAt: new Date(),
            },
        });

        // Keep the derived eligibility cache consistent after an approval/rejection.
        await refreshReferralIncomeCache(tx, application.appUserId);

        return updated;
    });
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

export const ReferralService = {
    applyForReferralIncome,
    getMyReferral,
    getDefaultReferralCode,
    getPartnerReferralDashboard,
    getAllApplications,
    reviewApplication,
    recalculateReferrerEligibilityForOrder,
    recalculateEligibilityForUser,
    reconcileAllReferralEligibility,
    getReferralStatus,
    getActiveReferredCount,
};