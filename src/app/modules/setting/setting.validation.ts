import { z } from "zod";

// Mirrors the referral code rule used everywhere else: alphanumeric, at most 32 chars.
export const updateDefaultReferralSettingZodSchema = z.object({
    referralCode: z
        .string()
        .trim()
        .min(1, "Referral code is required")
        .max(32, "Invalid referral code")
        .regex(/^[A-Za-z0-9]+$/, "Invalid referral code"),
});

export const SettingValidation = {
    updateDefaultReferralSettingZodSchema,
};