/* eslint-disable @typescript-eslint/no-explicit-any */
import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { auth } from "../../lib/auth";
import { prisma } from "../../lib/prisma";
import { UserStatus } from "../../../generated/prisma/enums";
import { tokenUtils } from "../../utils/token";
import { IRequestUser } from "../../interfaces/requestUser.interface";
import { ILoginAppUserPayload, IRegisterAppUserPayload } from "./auth.interface";


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

        const accessToken = tokenUtils.getAccessToken({
            userId: data.user.id,
            role: data.user.role,
            name: data.user.name,
            email: data.user.email,
        })

        const refreshToken = tokenUtils.getRefreshToken({
            userId: data.user.id,
            role: data.user.role,
            name: data.user.name,
            email: data.user.email,
        })

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

    const accessToken = tokenUtils.getAccessToken({
        userId: data.user.id,
        role: data.user.role,
        name: data.user.name,
        email: data.user.email,
    })

    const refreshToken = tokenUtils.getRefreshToken({
        userId: data.user.id,
        role: data.user.role,
        name: data.user.name,
        email: data.user.email,
    })

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


export const AuthService = {
    registerUser,
    loginUser,
    getMe,
}
