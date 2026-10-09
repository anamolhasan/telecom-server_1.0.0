import status from "http-status";
import { Prisma, ReferralApplication } from "../../../generated/prisma/client";
import {
    OrderStatus,
    PaymentStatus,
    ReferralApplicationStatus,
} from "../../../generated/prisma/enums";
import { REFERRAL_ACTIVE_MONTHS } from "../../constants/telecom.constant";
import AppError from "../../errorHelpers/AppError";
import { IQueryParams, PrismaModelDelegate } from "../../interfaces/query.interface";
import { IRequestUser } from "../../interfaces/requestUser.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { IReviewReferralApplicationPayload } from "./referral.interface";
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

// Count distinct active referred accounts for a referrer.
// A referred account is counted once, regardless of the number of qualifying purchases.
export const getActiveReferredCount = async (
    tx: Prisma.TransactionClient,
    appUserId: string,
    now: Date = new Date(),
): Promise<number> => {
    const referredUsers = await tx.appUser.findMany({
        where: { referredBy: appUserId, isDeleted: false },
        select: { authUserId: true },
    });

    if (referredUsers.length === 0) {
        return 0;
    }

    const cutoff = subtractMonths(now, REFERRAL_ACTIVE_MONTHS);

    const qualifiedByUser = await tx.order.groupBy({
        by: ["userId"],
        where: {
            userId: { in: referredUsers.map((user) => user.authUserId) },
            status: OrderStatus.COMPLETED,
            paymentStatus: PaymentStatus.PAID,
            completedAt: { gte: cutoff },
        },
    });

    return qualifiedByUser.length;
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
            },
        });
    });
};

const getMyReferral = async (user: IRequestUser) => {
    const appUser = await prisma.appUser.findUnique({
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

    const eligibilityStatus = await getReferralStatus(prisma, appUser.id);

    const referrals = await prisma.appUser.findMany({
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
        eligibility: {
            approved: eligibilityStatus.approved,
            activeReferredCount: eligibilityStatus.activeReferredCount,
            eligible: eligibilityStatus.eligible,
        },
        referralIncomeEligible: appUser.referralIncomeEligible,
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
    getAllApplications,
    reviewApplication,
    recalculateReferrerEligibilityForOrder,
    recalculateEligibilityForUser,
    reconcileAllReferralEligibility,
    getReferralStatus,
    getActiveReferredCount,
};