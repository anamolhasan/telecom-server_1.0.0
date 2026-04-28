import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./prisma";
import { Role, UserStatus } from "../../generated/prisma/enums";
// If your Prisma file is located elsewhere, you can change the path



export const auth = betterAuth({
    database: prismaAdapter(prisma, {
        provider: "postgresql", // or "mysql", "postgresql", ...etc
    }),
   // ─── Email & Password ────────────────────────────────────────────────────
    emailAndPassword: {
        enabled: true,
        requireEmailVerification: true,
    },
      // ─── Additional User Fields ──────────────────────────────────────────────
    user:{
        additionalFields:{
            role:{
                type:'string',
                required:true,
                defaultValue:Role.USER
            },
            status:{
                type:'string',
                required:true,
                defaultValue:UserStatus.ACTIVE
            },
            needPasswordChange:{
                type :'boolean',
                required:true,
                defaultValue:false
            },
            isDeleted:{
                type:'boolean',
                required:true,
                defaultValue:false
            },
            deletedAt: {
                type:'date',
                required:false,
                defaultValue:null
            },
            phone: {
                type:'string',
                required:false
            },
            phoneVerified: {
                type: "boolean",
                required: false,
                defaultValue: false,
            },
        }
    }
});