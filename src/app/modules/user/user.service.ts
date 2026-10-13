/* eslint-disable @typescript-eslint/no-explicit-any */
import status from "http-status";
import { Prisma, User } from "../../../generated/prisma/client";
import { Role, UserStatus } from "../../../generated/prisma/enums";
import {
    canChangeRole,
    canCreateRole,
    canManageTarget,
} from "../../constants/rbac.constant";
import AppError from "../../errorHelpers/AppError";
import { IQueryParams, PrismaModelDelegate } from "../../interfaces/query.interface";
import { IRequestUser } from "../../interfaces/requestUser.interface";
import { auth } from "../../lib/auth";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { generateUniqueReferralCode } from "../../utils/referralCode";
import {
    ICreateStaffPayload,
    IUpdateUserProfilePayload,
    IUpdateUserRolePayload,
    IUpdateUserStatusPayload,
} from "./user.interface";

type UserModuleClient = Prisma.TransactionClient;

const userDetailSelect = {
    id: true,
    name: true,
    email: true,
    phone: true,
    emailVerified: true,
    phoneVerified: true,
    role: true,
    status: true,
    needPasswordChange: true,
    image: true,
    isDeleted: true,
    deletedAt: true,
    createdAt: true,
    updatedAt: true,
    appUser: {
        select: {
            id: true,
            profilePhoto: true,
            contactNumber: true,
            address: true,
            country: true,
            canEarn: true,
            balance: true,
            totalEarned: true,
            referralIncomeEligible: true,
            referralCode: true,
            referredBy: true,
            lastLogin: true,
            isDeleted: true,
            deletedAt: true,
            createdAt: true,
            updatedAt: true,
            referrer: {
                select: {
                    id: true,
                    referralCode: true,
                    authUser: {
                        select: { id: true, name: true, email: true },
                    },
                },
            },
            _count: {
                select: { referrals: true },
            },
        },
    },
} as const;

const isDuplicateKeyError = (error: unknown): boolean =>
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

const createStaffAccount = async (
    payload: ICreateStaffPayload,
    actor: IRequestUser,
    client: UserModuleClient = prisma as unknown as UserModuleClient,
) => {
    if (!canCreateRole(actor.role, payload.role)) {
        throw new AppError(
            status.FORBIDDEN,
            "You do not have permission to create an account with this role.",
        );
    }

    // better-auth normalizes emails to lower case on write, so the duplicate
    // pre-check must use the same normalization to reliably return 409.
    const email = payload.email.trim().toLowerCase();

    const existing = await client.user.findUnique({
        where: { email },
        select: { id: true },
    });

    if (existing) {
        throw new AppError(status.CONFLICT, "An account with this email already exists.");
    }

    let signUp: any;
    try {
        // `role` and `needPasswordChange` are intentionally NOT sent to better-auth:
        // they are configured as `input: false` and would be ignored/forced to their
        // defaults anyway. The granted role is applied explicitly below, server-side.
        signUp = await auth.api.signUpEmail({
            body: {
                name: payload.name,
                email,
                password: payload.password,
                rememberMe: false,
            },
        });
    } catch (error: any) {
        throw new AppError(
            error?.statusCode || status.BAD_REQUEST,
            error?.body?.message || error?.message || "Failed to create staff account.",
        );
    }

    const authUserId = signUp?.user?.id;
    if (!authUserId) {
        throw new AppError(status.BAD_REQUEST, "Failed to create staff account.");
    }

    try {
        await client.user.update({
            where: { id: authUserId },
            data: { role: payload.role, needPasswordChange: true },
        });

        await client.appUser.create({
            data: {
                authUserId,
                canEarn: false,
                profilePhoto: payload.profilePhoto,
                contactNumber: payload.contactNumber,
                referralCode: await generateUniqueReferralCode(client),
            },
        });

        const createdUser = await client.user.findUnique({
            where: { id: authUserId },
            select: userDetailSelect,
        });

        if (!createdUser) {
            throw new AppError(status.INTERNAL_SERVER_ERROR, "Failed to load the created account.");
        }

        return createdUser;
    } catch (error) {
        await client.user.delete({ where: { id: authUserId } }).catch(() => undefined);
        throw error;
    }
};

const getUsers = async (
    query: IQueryParams,
    client: UserModuleClient = prisma as unknown as UserModuleClient,
) => {
    // The user directory hides soft-deleted accounts by default, but an explicit
    // `isDeleted` filter lets role managers review deleted accounts and restore
    // them. Any value other than "true" is treated as "not deleted".
    const isDeleted = query.isDeleted === "true";

    const queryBuilder = new QueryBuilder<User>(
        client.user as unknown as PrismaModelDelegate,
        query,
        {
            searchableFields: ["name", "email"],
            filterableFields: ["role", "status", "isDeleted"],
        },
    );

    return queryBuilder
        .search()
        .filter()
        .where({ isDeleted })
        .include({
            appUser: {
                include: {
                    referrer: {
                        select: {
                            id: true,
                            referralCode: true,
                            authUser: {
                                select: { id: true, name: true, email: true },
                            },
                        },
                    },
                    _count: { select: { referrals: true } },
                },
            },
        })
        .sort()
        .paginate()
        .fields()
        .execute();
};

const getUserStats = async (
    client: UserModuleClient = prisma as unknown as UserModuleClient,
) => {
    const [statusGroups, roleGroups, deleted] = await Promise.all([
        client.user.groupBy({
            by: ["status"],
            where: { isDeleted: false },
            _count: { _all: true },
        }),
        client.user.groupBy({
            by: ["role"],
            where: { isDeleted: false },
            _count: { _all: true },
        }),
        client.user.count({ where: { isDeleted: true } }),
    ]);

    const byStatus = Object.values(UserStatus).reduce(
        (accumulator, value) => ({ ...accumulator, [value]: 0 }),
        {} as Record<UserStatus, number>,
    );
    for (const group of statusGroups) {
        byStatus[group.status] = group._count._all;
    }

    const byRole = Object.values(Role).reduce(
        (accumulator, value) => ({ ...accumulator, [value]: 0 }),
        {} as Record<Role, number>,
    );
    for (const group of roleGroups) {
        byRole[group.role] = group._count._all;
    }

    const total = Object.values(byStatus).reduce(
        (sum, value) => sum + value,
        0,
    );

    return {
        total,
        active: byStatus[UserStatus.ACTIVE],
        pending: byStatus[UserStatus.PENDING],
        suspended: byStatus[UserStatus.SUSPENDED],
        blocked: byStatus[UserStatus.BLOCKED],
        inactive: byStatus[UserStatus.INACTIVE],
        sleeping: byStatus[UserStatus.SLEEPING],
        verified: byStatus[UserStatus.VERIFIED],
        deleted,
        byStatus,
        byRole,
    };
};

const getUserById = async (
    id: string,
    actor: IRequestUser,
    client: UserModuleClient = prisma as unknown as UserModuleClient,
) => {
    const user = await client.user.findUnique({
        where: { id },
        select: userDetailSelect,
    });

    if (!user) {
        throw new AppError(status.NOT_FOUND, "User not found.");
    }

    if (actor.userId !== user.id && !canManageTarget(actor.role, user.role)) {
        throw new AppError(
            status.FORBIDDEN,
            "You do not have permission to view this user.",
        );
    }

    return user;
};

const updateProfile = async (
    id: string,
    payload: IUpdateUserProfilePayload,
    actor: IRequestUser,
    client: UserModuleClient = prisma as unknown as UserModuleClient,
) => {
    const target = await client.user.findUnique({
        where: { id },
        select: { id: true, role: true },
    });

    if (!target) {
        throw new AppError(status.NOT_FOUND, "User not found.");
    }

    if (actor.userId !== target.id && !canManageTarget(actor.role, target.role)) {
        throw new AppError(
            status.FORBIDDEN,
            "You do not have permission to update this user.",
        );
    }

    const userData: { name?: string; phone?: string; image?: string } = {};
    if (payload.name !== undefined) userData.name = payload.name;
    if (payload.phone !== undefined) userData.phone = payload.phone;
    if (payload.image !== undefined) userData.image = payload.image;

    const appUserData: {
        profilePhoto?: string;
        contactNumber?: string;
        address?: string;
        country?: string;
    } = {};
    if (payload.profilePhoto !== undefined) appUserData.profilePhoto = payload.profilePhoto;
    if (payload.contactNumber !== undefined) appUserData.contactNumber = payload.contactNumber;
    if (payload.address !== undefined) appUserData.address = payload.address;
    if (payload.country !== undefined) appUserData.country = payload.country;

    try {
        await client.$transaction(async (tx) => {
            if (Object.keys(userData).length > 0) {
                await tx.user.update({ where: { id }, data: userData });
            }
            if (Object.keys(appUserData).length > 0) {
                await tx.appUser.updateMany({ where: { authUserId: id }, data: appUserData });
            }
        });
    } catch (error: any) {
        if (isDuplicateKeyError(error)) {
            throw new AppError(status.CONFLICT, "Phone number is already in use.");
        }
        throw error;
    }

    const updated = await client.user.findUnique({
        where: { id },
        select: userDetailSelect,
    });

    return updated;
};

const updateStatus = async (
    id: string,
    payload: IUpdateUserStatusPayload,
    actor: IRequestUser,
    client: UserModuleClient = prisma as unknown as UserModuleClient,
) => {
    const target = await client.user.findUnique({
        where: { id },
        select: { id: true, role: true, status: true },
    });

    if (!target) {
        throw new AppError(status.NOT_FOUND, "User not found.");
    }

    if (actor.userId === target.id) {
        throw new AppError(
            status.FORBIDDEN,
            "You cannot change the status of your own account.",
        );
    }

    if (!canManageTarget(actor.role, target.role)) {
        throw new AppError(
            status.FORBIDDEN,
            "You do not have permission to change this user's status.",
        );
    }

    if (payload.status === target.status) {
        throw new AppError(status.BAD_REQUEST, "User already has this status.");
    }

    return client.user.update({
        where: { id },
        data: { status: payload.status },
        select: userDetailSelect,
    });
};

const changeRole = async (
    id: string,
    payload: IUpdateUserRolePayload,
    actor: IRequestUser,
    client: UserModuleClient = prisma as unknown as UserModuleClient,
) => {
    const target = await client.user.findUnique({
        where: { id },
        select: { id: true, role: true },
    });

    if (!target) {
        throw new AppError(status.NOT_FOUND, "User not found.");
    }

    if (actor.userId === target.id) {
        throw new AppError(
            status.FORBIDDEN,
            "You cannot change the role of your own account.",
        );
    }

    if (!canChangeRole(actor.role, target.role, payload.role)) {
        throw new AppError(
            status.FORBIDDEN,
            "You do not have permission to change this user's role to the requested role.",
        );
    }

    if (payload.role === target.role) {
        throw new AppError(status.BAD_REQUEST, "User already has this role.");
    }

    return client.$transaction(async (tx) => {
        await tx.user.update({
            where: { id },
            data: { role: payload.role },
        });

        return tx.user.findUnique({
            where: { id },
            select: userDetailSelect,
        });
    });
};

const softDeleteUser = async (
    id: string,
    actor: IRequestUser,
    client: UserModuleClient = prisma as unknown as UserModuleClient,
) => {
    const target = await client.user.findUnique({
        where: { id },
        select: { id: true, role: true },
    });

    if (!target) {
        throw new AppError(status.NOT_FOUND, "User not found.");
    }

    if (actor.userId === target.id) {
        throw new AppError(
            status.FORBIDDEN,
            "You cannot delete your own account.",
        );
    }

    if (
        (target.role === Role.SUPER_ADMIN && actor.role !== Role.SUPER_ADMIN) ||
        (target.role !== Role.SUPER_ADMIN && !canManageTarget(actor.role, target.role))
    ) {
        throw new AppError(
            status.FORBIDDEN,
            "You do not have permission to delete this user.",
        );
    }

    const deletedAt = new Date();

    await client.$transaction(async (tx) => {
        await tx.user.update({
            where: { id },
            data: { isDeleted: true, deletedAt, status: UserStatus.DELETED },
        });
        await tx.appUser.updateMany({
            where: { authUserId: id },
            data: { isDeleted: true, deletedAt },
        });
        await tx.session.deleteMany({ where: { userId: id } });
    });

    return { id, deletedAt };
};

// Reverses a soft delete. The account, its app profile and the ability to sign
// in again are restored. Sessions were revoked on delete and are intentionally
// not recreated; the user signs in again normally.
const restoreUser = async (
    id: string,
    actor: IRequestUser,
    client: UserModuleClient = prisma as unknown as UserModuleClient,
) => {
    const target = await client.user.findUnique({
        where: { id },
        select: { id: true, role: true, isDeleted: true },
    });

    if (!target) {
        throw new AppError(status.NOT_FOUND, "User not found.");
    }

    if (!target.isDeleted) {
        throw new AppError(status.BAD_REQUEST, "This user is not deleted.");
    }

    if (
        (target.role === Role.SUPER_ADMIN && actor.role !== Role.SUPER_ADMIN) ||
        (target.role !== Role.SUPER_ADMIN && !canManageTarget(actor.role, target.role))
    ) {
        throw new AppError(
            status.FORBIDDEN,
            "You do not have permission to restore this user.",
        );
    }

    await client.$transaction(async (tx) => {
        await tx.user.update({
            where: { id },
            data: { isDeleted: false, deletedAt: null, status: UserStatus.ACTIVE },
        });
        await tx.appUser.updateMany({
            where: { authUserId: id },
            data: { isDeleted: false, deletedAt: null },
        });
    });

    const restored = await client.user.findUnique({
        where: { id },
        select: userDetailSelect,
    });

    return restored;
};

export const UserService = {
    createStaffAccount,
    getUsers,
    getUserStats,
    getUserById,
    updateProfile,
    updateStatus,
    changeRole,
    softDeleteUser,
    restoreUser,
};