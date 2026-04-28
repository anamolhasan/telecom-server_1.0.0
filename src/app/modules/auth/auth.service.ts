import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { auth } from "../../lib/auth";
import { prisma } from "../../lib/prisma";
import { UserStatus } from "../../../generated/prisma/enums";


interface IRegisterAppUserPayload {
    name: string;
    email: string;
    password: string;
}

const registerUser = async (payload:IRegisterAppUserPayload) => {
    const {name, email, password} = payload

    const data = await auth.api.signUpEmail({
        body:{
            name,
            email,
            password
        }
    })

    if(!data.user){
        throw new AppError(status.BAD_REQUEST, 'Failed to register patient')
    }

    try {
        const appUser = await prisma.$transaction(async(tx)=>{

            const appUserTx = await tx.appUser.create({
                data:{
                    authUserId: data.user.id,
                    name: payload.name,
                    email:payload.email
                }
            })
            return appUserTx
        })

        return {
            ...data,
            appUser
        }
    } catch (error) {
        console.log('Transaction error', error)
        await prisma.user.delete({
            where:{
                id:data.user.id
            }
        })
        throw error
    }
}

interface ILoginAppUserPayload {
    email:string;
    password:string;
}

const loginUser = async (payload:ILoginAppUserPayload) => {
    const {email, password} = payload

    const data = await auth.api.signInEmail({
        body:{
            email,
            password
        }
    })

    if(data.user.status === UserStatus.BLOCKED){
        throw new AppError(status.FORBIDDEN, 'User is blocked')
    }

    if(data.user.isDeleted || data.user.status === UserStatus.DELETED){
        throw new AppError(status.NOT_FOUND, 'User is deleted')
    }

    return {
        ...data
    }
}


export const AuthService = {
    registerUser,
    loginUser,
}