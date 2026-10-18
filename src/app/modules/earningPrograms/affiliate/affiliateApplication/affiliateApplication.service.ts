import status from "http-status";
import { AffiliateApplication, Prisma } from "../../../../../generated/prisma/client";
import {
    AffiliateApplicationStatus,
    Role,
} from "../../../../../generated/prisma/enums";
import AppError from "../../../../errorHelpers/AppError";
import { IQueryParams, PrismaModelDelegate } from "../../../../interfaces/query.interface";
import { IRequestUser } from "../../../../interfaces/requestUser.interface";
import { prisma } from "../../../../lib/prisma";
import { QueryBuilder } from "../../../../utils/QueryBuilder";
import {
    IReviewAffiliateApplicationPayload,
    ISubmitAffiliateApplicationPayload,
} from "./affiliateApplication.interface";


const APPLICATION_STATUS_TRANSITIONS: Record<
    AffiliateApplicationStatus,
    AffiliateApplicationStatus[]
> = {
    [AffiliateApplicationStatus.PENDING]: [
        AffiliateApplicationStatus.APPROVED,
        AffiliateApplicationStatus.REJECTED,
    ],
    [AffiliateApplicationStatus.APPROVED]: [],
    [AffiliateApplicationStatus.REJECTED]: [],
};

const submitAffiliateApplication = async (
    user: IRequestUser,
    payload: ISubmitAffiliateApplicationPayload = {},
    client: Prisma.TransactionClient = prisma,
) => {
    // Any authenticated account may apply, whatever its system role: affiliate
    // membership is granted by approving this application, never by holding (or
    // lacking) a particular role.
    const appUser = await client.appUser.findUnique({
        where: { authUserId: user.userId },
    });

    if (!appUser) {
        throw new AppError(status.NOT_FOUND, "App user not found.");
    }

    if (appUser.isDeleted) {
        throw new AppError(status.BAD_REQUEST, "App user is deleted.");
    }

    return client.$transaction(async (tx) => {
        const existing = await tx.affiliateApplication.findUnique({
            where: { appUserId: appUser.id },
        });

        if (existing) {
            throw new AppError(
                status.BAD_REQUEST,
                "Affiliate application already submitted. Only one application is allowed.",
            );
        }

        return tx.affiliateApplication.create({
            data: {
                appUserId: appUser.id,
                status: AffiliateApplicationStatus.PENDING,
                reason: payload.reason ?? null,
            },
        });
    });
};

// Always returns the caller's application state (nullable) so the UI can render
// apply / pending / rejected / approved states without a 404 for users who never
// applied.
const getMyAffiliateApplication = async (user: IRequestUser) => {
    const appUser = await prisma.appUser.findUnique({
        where: { authUserId: user.userId },
    });

    if (!appUser) {
        throw new AppError(status.NOT_FOUND, "App user not found.");
    }

    const application = await prisma.affiliateApplication.findUnique({
        where: { appUserId: appUser.id },
        include: {
            reviewedBy: { select: { name: true, email: true } },
        },
    });

    return { application };
};

const getAllAffiliateApplications = async (query: IQueryParams) => {
    const queryBuilder = new QueryBuilder<AffiliateApplication>(
        prisma.affiliateApplication as unknown as PrismaModelDelegate,
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

const reviewAffiliateApplication = async (
    applicationId: string,
    payload: IReviewAffiliateApplicationPayload,
    adminUser: IRequestUser,
    client: Prisma.TransactionClient = prisma,
) => {
    // Only ADMIN or SUPER_ADMIN may approve or reject. The route enforces this too.
    if (adminUser.role !== Role.ADMIN && adminUser.role !== Role.SUPER_ADMIN) {
        throw new AppError(
            status.FORBIDDEN,
            "Only ADMIN or SUPER_ADMIN can review affiliate applications.",
        );
    }

    if (payload.status === AffiliateApplicationStatus.PENDING) {
        throw new AppError(
            status.BAD_REQUEST,
            "Cannot transition an application back to PENDING",
        );
    }

    const application = await client.affiliateApplication.findUnique({
        where: { id: applicationId },
        include: { appUser: true },
    });

    if (!application) {
        throw new AppError(status.NOT_FOUND, "Affiliate application not found.");
    }

    if (application.appUser.authUserId === adminUser.userId) {
        throw new AppError(
            status.FORBIDDEN,
            "You cannot review your own affiliate application.",
        );
    }

    const allowed = APPLICATION_STATUS_TRANSITIONS[application.status];

    if (!allowed.includes(payload.status)) {
        throw new AppError(
            status.BAD_REQUEST,
            `Cannot change affiliate application status from ${application.status} to ${payload.status}`,
        );
    }

    if (payload.status === AffiliateApplicationStatus.REJECTED) {
        if (!payload.rejectionReason || payload.rejectionReason.trim() === "") {
            throw new AppError(
                status.BAD_REQUEST,
                "Rejection reason is required when rejecting",
            );
        }
    }

    return client.$transaction(async (tx) =>
        tx.affiliateApplication.update({
            where: { id: applicationId },
            data: {
                status: payload.status,
                rejectionReason:
                    payload.status === AffiliateApplicationStatus.REJECTED
                        ? payload.rejectionReason
                        : null,
                reviewedById: adminUser.userId,
                reviewedAt: new Date(),
            },
        }),
    );
};

export const AffiliateApplicationService = {
    submitAffiliateApplication,
    getMyAffiliateApplication,
    getAllAffiliateApplications,
    reviewAffiliateApplication,
};
