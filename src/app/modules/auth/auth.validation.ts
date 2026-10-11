import { z } from "zod";
import { updateUserProfileZodSchema } from "../user/user.validation";

export const registerAppUserZodSchema = z.object({
    name: z.string().min(1, "Name is required"),
    email: z.string().email("Invalid email address"),
    password: z.string().min(6, "Password must be at least 6 characters"),
    // Optional referral code from a shared link. Never trusted as-is: resolved
    // and validated server-side before any referral link is written.
    referralCode: z
        .string()
        .trim()
        .min(1)
        .max(32)
        .regex(/^[A-Za-z0-9]+$/, "Invalid referral code")
        .optional(),
});

export const loginAppUserZodSchema = z.object({
    email: z.string().email("Invalid email address"),
    password: z.string().min(1, "Password is required"),
});

// Self-service profile update. Reuses the same non-privileged field set as the
// admin user update schema: role, status, balance, canEarn and other privileged
// fields are intentionally not accepted and are stripped on the server.
export const updateProfileZodSchema = updateUserProfileZodSchema;

// Self-service password change. Mirrors the register min-length policy (6).
// The current password is verified against the stored hash by better-auth; the
// new password is hashed and persisted through better-auth as well.
export const changePasswordZodSchema = z.object({
    currentPassword: z.string({ error: "Current password is required" }).min(1, "Current password is required"),
    newPassword: z.string({ error: "New password is required" }).min(1, "New password is required").min(6, "Password must be at least 6 characters"),
});

export const AuthValidation = {
    registerAppUserZodSchema,
    loginAppUserZodSchema,
    updateProfileZodSchema,
    changePasswordZodSchema,
};
