import status from "http-status";
import { Prisma } from "../../../generated/prisma/client";
import AppError from "../../errorHelpers/AppError";
import { IRequestUser } from "../../interfaces/requestUser.interface";
import { prisma } from "../../lib/prisma";
import {
    IDefaultReferralSetting,
    IUpdateDefaultReferralSettingPayload,
} from "./setting.interface";

type SettingClient = Prisma.TransactionClient | typeof prisma;

export const DEFAULT_REFERRAL_CODE_KEY = "DEFAULT_REFERRAL_CODE";

// The selected referrer must satisfy the same eligibility rules used at registration
// (registerUser): the code must exist on a live, non-deleted appUser. Any role works.
const findEligibleReferrerByCode = async (
    client: SettingClient,
    referralCode: string,
) => {
    const appUser = await client.appUser.findUnique({
        where: { referralCode: referralCode.toUpperCase() },
        select: {
            isDeleted: true,
            authUser: {
                select: { name: true, email: true, role: true, isDeleted: true },
            },
        },
    });

    if (!appUser || appUser.isDeleted || appUser.authUser.isDeleted) {
        return null;
    }

    return appUser.authUser;
};

const getDefaultReferralSetting = async (
    client: SettingClient = prisma,
): Promise<IDefaultReferralSetting> => {
    const setting = await client.systemSetting.findUnique({
        where: { key: DEFAULT_REFERRAL_CODE_KEY },
    });

    if (!setting) {
        return { referralCode: null, referrer: null };
    }

    const referrer = await findEligibleReferrerByCode(client, setting.value);

    if (!referrer) {
        return { referralCode: null, referrer: null };
    }

    return {
        referralCode: setting.value,
        referrer: {
            name: referrer.name,
            email: referrer.email,
            role: referrer.role,
        },
    };
};

// Validates the submitted code belongs to an eligible user, persists it as the single
// system-wide default, and returns the resolved setting. Stores the normalized code so
// lookups are deterministic; existing referral relationships are never modified.
const updateDefaultReferralSetting = async (
    payload: IUpdateDefaultReferralSettingPayload,
    actor: IRequestUser,
    client: SettingClient = prisma,
): Promise<IDefaultReferralSetting> => {
    const normalizedCode = payload.referralCode.trim().toUpperCase();

    const referrer = await findEligibleReferrerByCode(client, normalizedCode);

    if (!referrer) {
        throw new AppError(
            status.BAD_REQUEST,
            "Invalid default referral code. Select a user with an active referral code.",
        );
    }

    await client.systemSetting.upsert({
        where: { key: DEFAULT_REFERRAL_CODE_KEY },
        update: { value: normalizedCode, updatedBy: actor.userId },
        create: {
            key: DEFAULT_REFERRAL_CODE_KEY,
            value: normalizedCode,
            updatedBy: actor.userId,
        },
    });

    return {
        referralCode: normalizedCode,
        referrer: {
            name: referrer.name,
            email: referrer.email,
            role: referrer.role,
        },
    };
};

export const SettingService = {
    getDefaultReferralSetting,
    updateDefaultReferralSetting,
};