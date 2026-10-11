import path from "node:path";
import { pathToFileURL } from "node:url";
import status from "http-status";
import { Prisma } from "../../generated/prisma/client";
import { Role } from "../../generated/prisma/enums";
import { envVars } from "../config/env";
import AppError from "../errorHelpers/AppError";
import { auth } from "../lib/auth";
import { prisma } from "../lib/prisma";
import { generateUniqueReferralCode } from "./referralCode";

interface ISuperAdminSeedConfig {
    name: string;
    email: string;
    password: string;
}

const defaultSeedConfig = (): ISuperAdminSeedConfig => ({
    name: envVars.SUPER_ADMIN_NAME,
    email: envVars.SUPER_ADMIN_EMAIL,
    password: envVars.SUPER_ADMIN_PASSWORD,
});

export const seedSuperAdmin = async (
    config: ISuperAdminSeedConfig = defaultSeedConfig(),
    client: Prisma.TransactionClient = prisma as unknown as Prisma.TransactionClient,
): Promise<void> => {
    const { name, email, password } = config;

    if (!name?.trim() || !email?.trim() || !password?.trim()) {
        throw new AppError(
            status.INTERNAL_SERVER_ERROR,
            "Super admin seed configuration is incomplete. Set SUPER_ADMIN_NAME, SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD before seeding.",
        );
    }

    const existing = await client.user.findUnique({
        where: { email },
        select: { id: true, role: true },
    });

    if (existing) {
        if (existing.role === Role.SUPER_ADMIN) {
            console.log('Super admin already exists. Skipping seeding super admin.');
            return;
        }
        console.warn(
            `Super admin seed skipped: an account for SUPER_ADMIN_EMAIL already exists with role ${existing.role}. No role was changed.`,
        );
        return;
    }

    const anySuperAdmin = await client.user.findFirst({
        where: { role: Role.SUPER_ADMIN },
        select: { id: true },
    });

    if (anySuperAdmin) {
        console.warn(
            "Super admin seed skipped: a SUPER_ADMIN already exists with a different email. Grant additional super admin accounts manually.",
        );
        return;
    }

    const created = await auth.api.signUpEmail({
        body: {
            email,
            password,
            name,
            rememberMe: false,
        },
    });

    const createdUserId = created?.user?.id;
    if (!createdUserId) {
        throw new AppError(status.BAD_REQUEST, "Failed to create super admin account.");
    }

    try {
        // `role` is `input: false` on better-auth, so it is granted explicitly here.
        await client.user.update({
            where: { id: createdUserId },
            data: { emailVerified: true, role: Role.SUPER_ADMIN },
        });
        await client.appUser.create({
            data: { authUserId: createdUserId, referralCode: await generateUniqueReferralCode(client) },
        });
        console.log('Super admin created successfully.');
    } catch (error) {
        await client.user.delete({ where: { id: createdUserId } }).catch(() => undefined);
        throw error;
    }
};

const isMainModule = (): boolean => {
    if (process.env.VITEST === "true") {
        return false;
    }
    const entry = process.argv[1];
    if (!entry) {
        return false;
    }
    const resolvedEntry = path.resolve(entry);
    if (!resolvedEntry.endsWith("seed.ts")) {
        return false;
    }
    return import.meta.url === pathToFileURL(resolvedEntry).href;
};

if (isMainModule()) {
    seedSuperAdmin()
        .then(() => process.exit(0))
        .catch((error: unknown) => {
            console.error(
                "Failed to seed super admin:",
                error instanceof Error ? error.message : error,
            );
            process.exit(1);
        });
}