import status from "http-status";
import { Prisma, ReferralApplication } from "../../../../../generated/prisma/client";
import { ReferralApplicationStatus } from "../../../../../generated/prisma/enums";
import AppError from "../../../../errorHelpers/AppError";
import { IQueryParams, PrismaModelDelegate } from "../../../../interfaces/query.interface";
import { IRequestUser } from "../../../../interfaces/requestUser.interface";
import { prisma } from "../../../../lib/prisma";
import { QueryBuilder } from "../../../../utils/QueryBuilder";
import {
    IReviewReferralApplicationPayload,
    ISubmitReferralApplicationPayload,
} from "./referralApplication.interface";
import { ReferralService } from "../referral.service";


const APPLICATION_STATUS_TRANSITIONS: Record<ReferralApplicationStatus, ReferralApplicationStatus[]> = {
    [ReferralApplicationStatus.PENDING]: [
        ReferralApplicationStatus.APPROVED,
        ReferralApplicationStatus.REJECTED,
    ],
    [ReferralApplicationStatus.APPROVED]: [],
    [ReferralApplicationStatus.REJECTED]: [],
};

// One-time referral income application. A user may submit at most one application
// (enforced by the unique index on appUserId and the guard below).
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

// The caller's own referral application plus referred accounts and the live
// referral eligibility derived from core referral rules.
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

    const eligibilityStatus = await ReferralService.getReferralStatus(client, appUser.id);

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
        await ReferralService.refreshReferralIncomeCache(tx, application.appUserId);

        return updated;
    });
};

export const ReferralApplicationService = {
    applyForReferralIncome,
    getMyReferral,
    getAllApplications,
    reviewApplication,
};
