/* eslint-disable @typescript-eslint/no-explicit-any */
import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { auth } from "../../lib/auth";
import { prisma } from "../../lib/prisma";
import { Role, UserStatus } from "../../../generated/prisma/enums";
import { tokenUtils } from "../../utils/token";
import { jwtUtils } from "../../utils/jwt";
import { envVars } from "../../config/env";
import { IRequestUser } from "../../interfaces/requestUser.interface";
import { UserService } from "../user/user.service";
import { IUpdateUserProfilePayload } from "../user/user.interface";
import { IChangePasswordPayload, ILoginAppUserPayload, IRegisterAppUserPayload } from "./auth.interface";

const createTokenPayload = (user: {
    id: string;
    role: string;
    name: string;
    email: string;
}) => ({
    userId: user.id,
    role: user.role as Role,
    name: user.name,
    email: user.email,
})


const registerUser = async (payload: IRegisterAppUserPayload) => {
    const { name, email, password } = payload

    let data;

    try {
        data = await auth.api.signUpEmail({
            body: {
                name,
                email,
                password
            }
        })
    } catch (error: any) {
        throw new AppError(
            error.statusCode || status.BAD_REQUEST,
            error.body?.message || error.message || "Registration failed"
        );
    }

    if (!data.user) {
        throw new AppError(status.BAD_REQUEST, 'Failed to register user')
    }

    try {
        const appUser = await prisma.$transaction(async (tx) => {
            const appUserTx = await tx.appUser.create({
                data: {
                    authUserId: data.user.id
                }
            })
            return appUserTx
        })

        const accessToken = tokenUtils.getAccessToken(createTokenPayload(data.user))

        const refreshToken = tokenUtils.getRefreshToken(createTokenPayload(data.user))

        return {
            ...data,
            appUser,
            accessToken,
            refreshToken
        }
    } catch (error) {
        console.log('Transaction error', error)
        await prisma.user.delete({
            where: {
                id: data.user.id
            }
        })
        throw error
    }
}

const loginUser = async (payload: ILoginAppUserPayload) => {
    const { email, password } = payload

    const data = await auth.api.signInEmail({
        body: {
            email,
            password
        }
    })

    if (data.user.status === UserStatus.BLOCKED) {
        throw new AppError(status.FORBIDDEN, 'User is blocked')
    }

    if (data.user.isDeleted || data.user.status === UserStatus.DELETED) {
        throw new AppError(status.NOT_FOUND, 'User is deleted')
    }

    const accessToken = tokenUtils.getAccessToken(createTokenPayload(data.user))

    const refreshToken = tokenUtils.getRefreshToken(createTokenPayload(data.user))

    return {
        ...data,
        accessToken,
        refreshToken
    }
}

const getMe = async (user: IRequestUser) => {
    const isUserExists = await prisma.user.findUnique({
        where: {
            id: user.userId
        },
        include: {
            appUser: true
        }
    })

    if (!isUserExists) {
        throw new AppError(status.NOT_FOUND, 'User not found')
    }

    return isUserExists
}

const updateMe = async (user: IRequestUser, payload: IUpdateUserProfilePayload) => {
    const updated = await UserService.updateProfile(user.userId, payload, user);

    if (!updated) {
        throw new AppError(status.NOT_FOUND, 'User not found')
    }

    // Return the same shape as GET /auth/me so the client can refresh its cache in one call.
    return getMe(user)
}

const changePassword = async (
    payload: IChangePasswordPayload,
    sessionToken: string | undefined,
    user: IRequestUser,
) => {
    if (!sessionToken) {
        throw new AppError(status.UNAUTHORIZED, 'Unauthorized access! No session token provided.')
    }

    const { currentPassword, newPassword } = payload

    // Delegate verification, policy enforcement and hashing to better-auth.
    // `revokeOtherSessions` invalidates every other session and issues a fresh
    // session token for this one, which we persist on the response below.
    // The raw session token is sent as a bearer token; better-auth's bearer
    // plugin signs it internally before session lookup (RizqifyBD stores the
    // raw token in its cookie/DB, so a plain cookie would fail signature checks).
    let result
    try {
        result = await auth.api.changePassword({
            body: {
                currentPassword,
                newPassword,
                revokeOtherSessions: true,
            },
            headers: new Headers({
                Authorization: `Bearer ${sessionToken}`,
            }),
        })
    } catch (error: any) {
        const code = error?.body?.code
        const betterAuthMessage =
            typeof error?.body?.message === "string" ? error.body.message : undefined

        let message: string
        if (code === "INVALID_PASSWORD") {
            message = "Current password is incorrect."
        } else if (betterAuthMessage) {
            // better-auth APIError messages are user-facing (e.g. PASSWORD_TOO_SHORT).
            message = betterAuthMessage
        } else {
            // Never surface raw/internal error details to the client.
            message = "Failed to change password. Please try again."
        }

        throw new AppError(error?.statusCode || status.INTERNAL_SERVER_ERROR, message)
    }

    // The current user is identified from the authenticated session context
    // (never from client input). Clear the forced-change flag once they comply.
    const dbUser = await prisma.user.findUnique({
        where: {
            id: user.userId,
        },
    })

    if (dbUser?.needPasswordChange) {
        await prisma.user.update({
            where: {
                id: user.userId,
            },
            data: {
                needPasswordChange: false,
            },
        })
    }

    const tokenPayload = createTokenPayload({
        id: user.userId,
        role: user.role,
        name: dbUser?.name ?? '',
        email: user.email,
    })

    const accessToken = tokenUtils.getAccessToken(tokenPayload)
    const refreshToken = tokenUtils.getRefreshToken(tokenPayload)

    return {
        token: (result as { token?: string | null } | undefined)?.token ?? sessionToken,
        accessToken,
        refreshToken,
    }
}

const refreshTokens = async (refreshToken: string, sessionToken: string | undefined) => {
    if (!refreshToken) {
        throw new AppError(status.UNAUTHORIZED, 'Unauthorized access! No refresh token provided.')
    }

    if (!sessionToken) {
        throw new AppError(status.UNAUTHORIZED, 'Unauthorized access! No session token provided.')
    }

    const verifiedToken = jwtUtils.verifyToken(refreshToken, envVars.REFRESH_TOKEN_SECRET)

    if (!verifiedToken.success) {
        throw new AppError(status.UNAUTHORIZED, 'Unauthorized access! Invalid refresh token.')
    }

    const tokenPayload = verifiedToken.data as {
        userId: string;
        role: Role;
        name: string;
        email: string;
    }

    const sessionExists = await prisma.session.findFirst({
        where: {
            token: sessionToken,
            expiresAt: {
                gt: new Date(),
            },
        },
        include: {
            user: true,
        },
    })

    if (!sessionExists || !sessionExists.user) {
        throw new AppError(status.UNAUTHORIZED, 'Unauthorized access! Invalid or expired session.')
    }

    if (sessionExists.user.id !== tokenPayload.userId) {
        throw new AppError(status.UNAUTHORIZED, 'Unauthorized access! Refresh token and session do not match.')
    }

    const user = sessionExists.user

    if (user.status === UserStatus.BLOCKED || user.status === UserStatus.DELETED || user.isDeleted) {
        throw new AppError(status.UNAUTHORIZED, 'Unauthorized access! User is not active.')
    }

    const sessionLifeTime =
        new Date(sessionExists.expiresAt).getTime() - new Date(sessionExists.createdAt).getTime()

    const newExpiresAt = new Date(Date.now() + Math.max(sessionLifeTime, 0))

    await prisma.session.update({
        where: {
            id: sessionExists.id,
        },
        data: {
            expiresAt: newExpiresAt,
        },
    })

    const payload = createTokenPayload(user)

    const accessToken = tokenUtils.getAccessToken(payload)
    const newRefreshToken = tokenUtils.getRefreshToken(payload)

    return {
        token: sessionToken,
        accessToken,
        refreshToken: newRefreshToken,
    }
}

const logoutUser = async (sessionTokens: string[]) => {
    const tokens = sessionTokens.filter(Boolean)

    if (tokens.length > 0) {
        await prisma.session.deleteMany({
            where: {
                token: {
                    in: tokens,
                },
            },
        })
    }

    return true
}


export const AuthService = {
    registerUser,
    loginUser,
    getMe,
    updateMe,
    changePassword,
    refreshTokens,
    logoutUser,
}
