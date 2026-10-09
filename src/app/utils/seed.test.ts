import { afterEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "../../generated/prisma/client";
import { Role } from "../../generated/prisma/enums";
import { seedSuperAdmin } from "./seed";

const mocks = vi.hoisted(() => {
    const tx = {
        user: {
            findUnique: vi.fn(),
            findFirst: vi.fn(),
            update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => ({
                id: args.where.id,
                ...args.data,
            })),
            delete: vi.fn().mockResolvedValue({}),
        },
        appUser: {
            create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
                id: "app1",
                ...args.data,
            })),
        },
    };
    const authMock = { api: { signUpEmail: vi.fn() } };
    const prisma = {
        user: tx.user,
        appUser: tx.appUser,
        $transaction: vi.fn(),
    };
    return { tx, prisma, authMock };
});

vi.mock("../lib/auth", () => ({ auth: mocks.authMock }));
vi.mock("../lib/prisma", () => ({ prisma: mocks.prisma }));

const signUpEmailMock = mocks.authMock.api.signUpEmail;
const validConfig = { name: "Rizqify Super Admin", email: "superadmin@x.com", password: "super-secret" };

afterEach(() => {
    vi.clearAllMocks();
});

describe("seedSuperAdmin", () => {
    it("creates the super admin via better-auth using the env-provided config", async () => {
        mocks.tx.user.findUnique.mockResolvedValue(null);
        mocks.tx.user.findFirst.mockResolvedValue(null);
        signUpEmailMock.mockResolvedValue({ user: { id: "u-sa" }, token: "tk" });

        await seedSuperAdmin(validConfig, mocks.tx as unknown as Prisma.TransactionClient);

        expect(signUpEmailMock).toHaveBeenCalledTimes(1);
        expect(signUpEmailMock).toHaveBeenCalledWith(
            expect.objectContaining({
                body: expect.objectContaining({
                    name: validConfig.name,
                    email: validConfig.email,
                    password: validConfig.password,
                    role: Role.SUPER_ADMIN,
                    needPasswordChange: false,
                }),
            }),
        );
        expect(mocks.tx.user.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: "u-sa" },
                data: expect.objectContaining({ emailVerified: true }),
            }),
        );
        expect(mocks.tx.appUser.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ authUserId: "u-sa" }),
            }),
        );
    });

    it("is idempotent when a super admin already exists", async () => {
        mocks.tx.user.findUnique.mockResolvedValue({ id: "u-sa", role: Role.SUPER_ADMIN });

        await seedSuperAdmin(validConfig, mocks.tx as unknown as Prisma.TransactionClient);

        expect(signUpEmailMock).not.toHaveBeenCalled();
        expect(mocks.tx.user.update).not.toHaveBeenCalled();
        expect(mocks.tx.appUser.create).not.toHaveBeenCalled();
    });

    it("never silently promotes an existing non-super-admin account", async () => {
        mocks.tx.user.findUnique.mockResolvedValue({ id: "u-x", role: Role.ADMIN });

        await seedSuperAdmin(validConfig, mocks.tx as unknown as Prisma.TransactionClient);

        expect(signUpEmailMock).not.toHaveBeenCalled();
        expect(mocks.tx.user.update).not.toHaveBeenCalled();
    });

    it("does not create a second super admin when a different one exists", async () => {
        mocks.tx.user.findUnique.mockResolvedValue(null);
        mocks.tx.user.findFirst.mockResolvedValue({ id: "u-other" });

        await seedSuperAdmin(validConfig, mocks.tx as unknown as Prisma.TransactionClient);

        expect(signUpEmailMock).not.toHaveBeenCalled();
        expect(mocks.tx.appUser.create).not.toHaveBeenCalled();
    });

    it("fails safely when the seed configuration is invalid", async () => {
        await expect(
            seedSuperAdmin(
                { name: "   ", email: validConfig.email, password: validConfig.password },
                mocks.tx as unknown as Prisma.TransactionClient,
            ),
        ).rejects.toThrow(/incomplete/i);

        await expect(
            seedSuperAdmin(
                { name: validConfig.name, email: "", password: validConfig.password },
                mocks.tx as unknown as Prisma.TransactionClient,
            ),
        ).rejects.toThrow(/incomplete/i);

        await expect(
            seedSuperAdmin(
                { name: validConfig.name, email: validConfig.email, password: "   " },
                mocks.tx as unknown as Prisma.TransactionClient,
            ),
        ).rejects.toThrow(/incomplete/i);

        expect(signUpEmailMock).not.toHaveBeenCalled();
        expect(mocks.tx.user.update).not.toHaveBeenCalled();
        expect(mocks.tx.appUser.create).not.toHaveBeenCalled();
    });
});