import { randomInt } from "node:crypto";
import { Prisma } from "../../generated/prisma/client";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

type ReferralCodeClient = {
    appUser: Prisma.TransactionClient["appUser"];
};

export const generateReferralCode = (length = 8): string => {
    let code = "";
    for (let i = 0; i < length; i++) {
        code += ALPHABET[randomInt(0, ALPHABET.length)];
    }
    return code;
};

export const generateUniqueReferralCode = async (
    client: ReferralCodeClient,
    length = 8,
    maxAttempts = 10,
): Promise<string> => {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const candidate = generateReferralCode(length);
        const existing = await client.appUser.findUnique({
            where: { referralCode: candidate },
            select: { id: true },
        });
        if (!existing) {
            return candidate;
        }
    }
    throw new Error("Could not generate a unique referral code");
};