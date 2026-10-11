import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { bearer } from "better-auth/plugins";
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
        requireEmailVerification: false,
        // Align better-auth's enforced minimum with RizqifyBD's declared policy
        // (zod `min(6)` in auth.validation.ts / user.validation.ts and the
        // change-password UI). Without this, better-auth defaults to 8 and
        // rejects otherwise-valid 6-7 character passwords.
        minPasswordLength: 6,
    },
      // ─── Additional User Fields ──────────────────────────────────────────────
    // Privileged fields are marked `input: false` so they can NEVER be set from a
    // client request body (e.g. POST /api/auth/sign-up/email or /api/auth/update-user).
    // They are only ever assigned server-side (auth service, staff creation, seed).
    user:{
        additionalFields:{
            role:{
                type:'string',
                required:true,
                defaultValue:Role.USER,
                input:false
            },
            status:{
                type:'string',
                required:true,
                defaultValue:UserStatus.ACTIVE,
                input:false
            },
            needPasswordChange:{
                type :'boolean',
                required:true,
                defaultValue:false,
                input:false
            },
            isDeleted:{
                type:'boolean',
                required:true,
                defaultValue:false,
                input:false
            },
            deletedAt: {
                type:'date',
                required:false,
                defaultValue:null,
                input:false
            },
            phone: {
                type:'string',
                required:false
            },
            phoneVerified: {
                type: "boolean",
                required: false,
                defaultValue: false,
                input:false
            },
        }
    },
    // Allows server-side better-auth API calls (e.g. auth.api.changePassword) to
    // authenticate with the raw session token via `Authorization: Bearer <token>`.
    // The plugin signs the token internally before session lookup, so RizqifyBD
    // keeps its existing raw-token cookie/DB model untouched.
    plugins: [
        bearer(),
    ],
});