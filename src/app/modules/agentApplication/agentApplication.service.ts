import status from "http-status";
import { AgentApplication, Prisma } from "../../../generated/prisma/client";
import { AgentApplicationStatus, Role } from "../../../generated/prisma/enums";
import AppError from "../../errorHelpers/AppError";
import { IQueryParams, PrismaModelDelegate } from "../../interfaces/query.interface";
import { IRequestUser } from "../../interfaces/requestUser.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import {
    IReviewAgentApplicationPayload,
    ISubmitAgentApplicationPayload,
} from "./agentApplication.interface";


const APPLICATION_STATUS_TRANSITIONS: Record<AgentApplicationStatus, AgentApplicationStatus[]> = {
    [AgentApplicationStatus.PENDING]: [AgentApplicationStatus.APPROVED, AgentApplicationStatus.REJECTED],
    [AgentApplicationStatus.APPROVED]: [],
    [AgentApplicationStatus.REJECTED]: [],
};

const submitAgentApplication = async (
    user: IRequestUser,
    payload: ISubmitAgentApplicationPayload = {},
    client: Prisma.TransactionClient = prisma,
) => {
    // Rule 8: only a logged-in USER may apply to become an AGENT.
    if (user.role !== Role.USER) {
        throw new AppError(
            status.FORBIDDEN,
            "Only USER accounts can apply to become an AGENT.",
        );
    }

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
        const existing = await tx.agentApplication.findUnique({
            where: { appUserId: appUser.id },
        });

        if (existing) {
            throw new AppError(
                status.BAD_REQUEST,
                "Agent application already submitted. Only one application is allowed.",
            );
        }

        return tx.agentApplication.create({
            data: {
                appUserId: appUser.id,
                status: AgentApplicationStatus.PENDING,
                reason: payload.reason ?? null,
            },
        });
    });
};

const getMyAgentApplication = async (user: IRequestUser) => {
    const appUser = await prisma.appUser.findUnique({
        where: { authUserId: user.userId },
    });

    if (!appUser) {
        throw new AppError(status.NOT_FOUND, "App user not found.");
    }

    const application = await prisma.agentApplication.findUnique({
        where: { appUserId: appUser.id },
        include: {
            reviewedBy: { select: { name: true, email: true } },
        },
    });

    if (!application) {
        throw new AppError(status.NOT_FOUND, "No agent application found for this account.");
    }

    return application;
};

const getAllAgentApplications = async (query: IQueryParams) => {
    const queryBuilder = new QueryBuilder<AgentApplication>(
        prisma.agentApplication as unknown as PrismaModelDelegate,
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

const reviewAgentApplication = async (
    applicationId: string,
    payload: IReviewAgentApplicationPayload,
    adminUser: IRequestUser,
    client: Prisma.TransactionClient = prisma,
) => {
    // Rule 8: only ADMIN or SUPER_ADMIN may approve or reject. The route enforces this too.
    if (adminUser.role !== Role.ADMIN && adminUser.role !== Role.SUPER_ADMIN) {
        throw new AppError(
            status.FORBIDDEN,
            "Only ADMIN or SUPER_ADMIN can review agent applications.",
        );
    }

    if (payload.status === AgentApplicationStatus.PENDING) {
        throw new AppError(
            status.BAD_REQUEST,
            "Cannot transition an application back to PENDING",
        );
    }

    const application = await client.agentApplication.findUnique({
        where: { id: applicationId },
        include: { appUser: true },
    });

    if (!application) {
        throw new AppError(status.NOT_FOUND, "Agent application not found.");
    }

    if (application.appUser.authUserId === adminUser.userId) {
        throw new AppError(
            status.FORBIDDEN,
            "You cannot review your own agent application.",
        );
    }

    const allowed = APPLICATION_STATUS_TRANSITIONS[application.status];

    if (!allowed.includes(payload.status)) {
        throw new AppError(
            status.BAD_REQUEST,
            `Cannot change agent application status from ${application.status} to ${payload.status}`,
        );
    }

    if (payload.status === AgentApplicationStatus.REJECTED) {
        if (!payload.rejectionReason || payload.rejectionReason.trim() === "") {
            throw new AppError(
                status.BAD_REQUEST,
                "Rejection reason is required when rejecting",
            );
        }
    }

    return client.$transaction(async (tx) => {
        const updated = await tx.agentApplication.update({
            where: { id: applicationId },
            data: {
                status: payload.status,
                rejectionReason:
                    payload.status === AgentApplicationStatus.REJECTED
                        ? payload.rejectionReason
                        : null,
                reviewedById: adminUser.userId,
                reviewedAt: new Date(),
            },
        });

        // Rule 8 + 9: approval promotes the account to AGENT and enables offer-sales commission.
        if (payload.status === AgentApplicationStatus.APPROVED) {
            await tx.user.update({
                where: { id: application.appUser.authUserId },
                data: { role: Role.AGENT },
            });
            await tx.appUser.update({
                where: { id: application.appUserId },
                data: { canEarn: true },
            });
        }

        return updated;
    });
};

export const AgentApplicationService = {
    submitAgentApplication,
    getMyAgentApplication,
    getAllAgentApplications,
    reviewAgentApplication,
};