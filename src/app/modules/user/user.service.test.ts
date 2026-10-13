import { afterEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "../../../generated/prisma/client";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../lib/auth";
import { UserService } from "./user.service";
import { UserValidation } from "./user.validation";

vi.mock("../../lib/auth", () => ({
    auth: { api: { signUpEmail: vi.fn() } },
}));
vi.mock("../../lib/prisma", () => ({ prisma: {} }));

const signUpEmailMock = vi.mocked(auth.api.signUpEmail);

interface IClientOverrides {
    target?: ({ id: string; role: Role; status?: string } & Record<string, unknown>) | null;
}

const makeClient = (overrides: IClientOverrides = {}) => {
    const tx = {
        user: {
            findUnique: vi.fn().mockResolvedValue(overrides.target ?? null),
            count: vi.fn().mockResolvedValue(0),
            findMany: vi.fn().mockResolvedValue([]),
            groupBy: vi.fn().mockResolvedValue([]),
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
            findUnique: vi.fn().mockResolvedValue(null),
            update: vi.fn().mockResolvedValue({}),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        session: {
            deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    };

    return tx;
};

const actor = (overrides: Partial<{ userId: string; role: Role; email: string }> = {}) => ({
    userId: "actor-1",
    role: Role.SUPER_ADMIN,
    email: "actor@x.com",
    ...overrides,
});

afterEach(() => {
    vi.clearAllMocks();
});

describe("createStaffAccount", () => {
    it("rejects staff account creation by a USER", async () => {
        const tx = makeClient();
        await expect(
            UserService.createStaffAccount(
                { name: "Agent", email: "agent@x.com", password: "secret1", role: Role.EMPLOYEE },
                actor({ role: Role.USER }),
                tx as unknown as Prisma.TransactionClient,
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
        expect(signUpEmailMock).not.toHaveBeenCalled();
    });

    it("rejects staff account creation by a non-role-manager (MODERATOR)", async () => {
        const tx = makeClient();
        await expect(
            UserService.createStaffAccount(
                { name: "Supporter", email: "sup@x.com", password: "secret1", role: Role.SUPPORTER },
                actor({ role: Role.MODERATOR }),
                tx as unknown as Prisma.TransactionClient,
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
        expect(signUpEmailMock).not.toHaveBeenCalled();
    });

    it("rejects creation of a SUPER_ADMIN by an ADMIN (rule 4)", async () => {
        const tx = makeClient();
        await expect(
            UserService.createStaffAccount(
                { name: "Bad", email: "bad@x.com", password: "secret1", role: Role.SUPER_ADMIN },
                actor({ role: Role.ADMIN }),
                tx as unknown as Prisma.TransactionClient,
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
        expect(signUpEmailMock).not.toHaveBeenCalled();
    });

    it("allows an ADMIN to create another ADMIN (rule 6)", async () => {
        const tx = makeClient();
        const createdUser = {
            id: "u-admin2",
            role: Role.ADMIN,
            name: "Admin Two",
            email: "admin2@x.com",
            status: "ACTIVE",
        };
        tx.user.findUnique
            .mockResolvedValueOnce(null)
            .mockResolvedValue(createdUser as never);
        signUpEmailMock.mockResolvedValue({
            user: { id: "u-admin2", role: Role.ADMIN, name: "Admin Two", email: "admin2@x.com" },
            token: "tk",
        } as never);

        const result = await UserService.createStaffAccount(
            { name: "Admin Two", email: "admin2@x.com", password: "secret1", role: Role.ADMIN },
            actor({ role: Role.ADMIN }),
            tx as unknown as Prisma.TransactionClient,
        );

        expect(result).toMatchObject({ role: Role.ADMIN });
        // Privileged fields are `input: false` on better-auth, so role is applied
        // server-side after sign-up rather than trusted from the request body.
        expect(signUpEmailMock).toHaveBeenCalledWith(
            expect.objectContaining({
                body: expect.not.objectContaining({ role: Role.ADMIN }),
            }),
        );
        expect(tx.user.update).toHaveBeenCalledWith({
            where: { id: "u-admin2" },
            data: { role: Role.ADMIN, needPasswordChange: true },
        });
    });

    it("allows an ADMIN to create a MODERATOR", async () => {
        const tx = makeClient();
        const createdUser = {
            id: "u-mod",
            role: Role.MODERATOR,
            name: "Mod",
            email: "mod@x.com",
            status: "ACTIVE",
        };
        tx.user.findUnique
            .mockResolvedValueOnce(null)
            .mockResolvedValue(createdUser as never);
        signUpEmailMock.mockResolvedValue({
            user: { id: "u-mod", role: Role.MODERATOR, name: "Mod", email: "mod@x.com" },
            token: "tk",
        } as never);

        const result = await UserService.createStaffAccount(
            { name: "Mod", email: "mod@x.com", password: "secret1", role: Role.MODERATOR },
            actor({ role: Role.ADMIN }),
            tx as unknown as Prisma.TransactionClient,
        );

        expect(result).toMatchObject({ role: Role.MODERATOR });
    });

    it("rejects staff account creation by a MODERATOR", async () => {
        const tx = makeClient();
        await expect(
            UserService.createStaffAccount(
                { name: "X", email: "x@x.com", password: "secret1", role: Role.SUPPORTER },
                actor({ role: Role.MODERATOR }),
                tx as unknown as Prisma.TransactionClient,
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
        expect(signUpEmailMock).not.toHaveBeenCalled();
    });

    it("rejects staff account creation by a SUPPORTER", async () => {
        const tx = makeClient();
        await expect(
            UserService.createStaffAccount(
                { name: "X", email: "x@x.com", password: "secret1", role: Role.MODERATOR },
                actor({ role: Role.SUPPORTER }),
                tx as unknown as Prisma.TransactionClient,
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
        expect(signUpEmailMock).not.toHaveBeenCalled();
    });

    it("allows a SUPER_ADMIN to create another SUPER_ADMIN (rule 2)", async () => {
        const tx = makeClient();
        tx.user.findUnique
            .mockResolvedValueOnce(null)
            .mockResolvedValue({
                id: "u-sa2",
                role: Role.SUPER_ADMIN,
                name: "Second SA",
                email: "sa2@x.com",
                status: "ACTIVE",
            } as never);
        signUpEmailMock.mockResolvedValue({
            user: { id: "u-sa2", role: Role.SUPER_ADMIN, name: "Second SA", email: "sa2@x.com" },
            token: "tk",
        } as never);

        const result = await UserService.createStaffAccount(
            { name: "Second SA", email: "sa2@x.com", password: "secret1", role: Role.SUPER_ADMIN },
            actor(),
            tx as unknown as Prisma.TransactionClient,
        );

        expect(result).toMatchObject({ role: Role.SUPER_ADMIN });
        expect(signUpEmailMock).toHaveBeenCalledWith(
            expect.objectContaining({
                body: expect.not.objectContaining({ role: Role.SUPER_ADMIN }),
            }),
        );
        expect(tx.user.update).toHaveBeenCalledWith({
            where: { id: "u-sa2" },
            data: { role: Role.SUPER_ADMIN, needPasswordChange: true },
        });
        expect(tx.appUser.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ authUserId: "u-sa2", canEarn: false }),
            }),
        );
    });

    it("prevents creating a customer account via the staff endpoint", async () => {
        const tx = makeClient();
        await expect(
            UserService.createStaffAccount(
                { name: "Customer", email: "cust@x.com", password: "secret1", role: Role.USER },
                actor(),
                tx as unknown as Prisma.TransactionClient,
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
        expect(signUpEmailMock).not.toHaveBeenCalled();
    });

    it("allows SUPER_ADMIN to create an ADMIN and never creates a role outside the granted one", async () => {
        const tx = makeClient();
        const createdUser = {
            id: "u-new",
            role: Role.ADMIN,
            name: "Admin",
            email: "admin@x.com",
            status: "ACTIVE",
        };
        tx.user.findUnique
            .mockResolvedValueOnce(null)
            .mockResolvedValue(createdUser as never);
        signUpEmailMock.mockResolvedValue({
            user: { id: "u-new", role: Role.ADMIN, name: "Admin", email: "admin@x.com" },
            token: "tk",
        } as never);

        const result = await UserService.createStaffAccount(
            { name: "Admin", email: "admin@x.com", password: "secret1", role: Role.ADMIN },
            actor(),
            tx as unknown as Prisma.TransactionClient,
        );

        expect(result).toMatchObject(createdUser);
        expect(signUpEmailMock).toHaveBeenCalledWith(
            expect.objectContaining({
                body: expect.not.objectContaining({ role: Role.ADMIN, needPasswordChange: true }),
            }),
        );
        expect(tx.user.update).toHaveBeenCalledWith({
            where: { id: "u-new" },
            data: { role: Role.ADMIN, needPasswordChange: true },
        });
        expect(tx.appUser.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ authUserId: "u-new", canEarn: false }),
            }),
        );
    });

    it("rejects a duplicate email with CONFLICT", async () => {
        const tx = makeClient({ target: { id: "existing", role: Role.USER } });
        await expect(
            UserService.createStaffAccount(
                { name: "Dup", email: "dup@x.com", password: "secret1", role: Role.MODERATOR },
                actor(),
                tx as unknown as Prisma.TransactionClient,
            ),
        ).rejects.toMatchObject({ statusCode: 409 });
        expect(signUpEmailMock).not.toHaveBeenCalled();
    });

    it("normalizes email casing so a case-variant duplicate is still rejected with CONFLICT", async () => {
        const tx = makeClient({ target: { id: "existing", role: Role.USER } });
        await expect(
            UserService.createStaffAccount(
                { name: "Dup", email: "  DUP@X.com ", password: "secret1", role: Role.MODERATOR },
                actor(),
                tx as unknown as Prisma.TransactionClient,
            ),
        ).rejects.toMatchObject({ statusCode: 409 });
        expect(tx.user.findUnique).toHaveBeenCalledWith({
            where: { email: "dup@x.com" },
            select: { id: true },
        });
        expect(signUpEmailMock).not.toHaveBeenCalled();
    });
});

describe("createStaffUserZodSchema", () => {
    const base = {
        name: "Staff",
        email: "staff@x.com",
        password: "secret1",
        role: Role.MODERATOR,
    };

    it("accepts an allowed staff role", () => {
        const parsed = UserValidation.createStaffUserZodSchema.safeParse({
            ...base,
            role: Role.ADMIN,
        });

        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(parsed.data.role).toBe(Role.ADMIN);
        }
    });

    it("strips unexpected and privileged fields", () => {
        const parsed = UserValidation.createStaffUserZodSchema.safeParse({
            ...base,
            status: "BLOCKED",
            balance: 9999,
            canEarn: true,
            isDeleted: true,
            id: "attacker",
            authUserId: "attacker",
            appUser: { canEarn: true },
        });

        expect(parsed.success).toBe(true);
        if (parsed.success) {
            const data = parsed.data as Record<string, unknown>;
            expect(data).not.toHaveProperty("status");
            expect(data).not.toHaveProperty("balance");
            expect(data).not.toHaveProperty("canEarn");
            expect(data).not.toHaveProperty("isDeleted");
            expect(data).not.toHaveProperty("id");
            expect(data).not.toHaveProperty("authUserId");
            expect(data).not.toHaveProperty("appUser");
        }
    });

    it("rejects a legacy AGENT role (agent status comes from an application approval)", () => {
        const parsed = UserValidation.createStaffUserZodSchema.safeParse({
            ...base,
            role: "AGENT",
        });

        expect(parsed.success).toBe(false);
    });

    it("rejects an invalid email and a short password", () => {
        expect(
            UserValidation.createStaffUserZodSchema.safeParse({
                ...base,
                email: "not-an-email",
            }).success,
        ).toBe(false);

        expect(
            UserValidation.createStaffUserZodSchema.safeParse({
                ...base,
                password: "123",
            }).success,
        ).toBe(false);
    });

    it("rejects a missing role", () => {
        expect(
            UserValidation.createStaffUserZodSchema.safeParse({
                name: "Staff",
                email: "staff@x.com",
                password: "secret1",
            }).success,
        ).toBe(false);
    });
});

describe("getUserById", () => {
    it("never selects the account (and therefore the password) for any user", async () => {
        const tx = makeClient({
            target: { id: "u1", role: Role.USER, name: "User", email: "user@x.com" },
        });

        const result = await UserService.getUserById(
            "u1",
            actor({ role: Role.ADMIN }),
            tx as unknown as Prisma.TransactionClient,
        );

        const select = tx.user.findUnique.mock.calls[0][0]?.select as Record<string, unknown>;
        expect(select).not.toHaveProperty("account");
        expect(JSON.stringify(result)).not.toContain("password");
    });

    it("prevents an ADMIN from viewing another ADMIN", async () => {
        const tx = makeClient({ target: { id: "admin2", role: Role.ADMIN } });
        await expect(
            UserService.getUserById(
                "admin2",
                actor({ role: Role.ADMIN }),
                tx as unknown as Prisma.TransactionClient,
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it("prevents an ADMIN from viewing a SUPER_ADMIN", async () => {
        const tx = makeClient({ target: { id: "sa", role: Role.SUPER_ADMIN } });
        await expect(
            UserService.getUserById(
                "sa",
                actor({ role: Role.ADMIN }),
                tx as unknown as Prisma.TransactionClient,
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
    });
});

describe("getUsers", () => {
    it("lists users without including the account", async () => {
        const tx = makeClient();
        tx.user.findMany.mockResolvedValue([{ id: "u1", role: Role.USER }]);

        const result = await UserService.getUsers(
            { page: "1", limit: "10" },
            tx as unknown as Prisma.TransactionClient,
        );

        const findManyArgs = tx.user.findMany.mock.calls[0][0] as Record<string, unknown>;
        expect(findManyArgs.where).toEqual({ isDeleted: false });
        expect(findManyArgs.include as Record<string, unknown>).not.toHaveProperty("account");
        expect(result.data).toHaveLength(1);
        expect(result.meta.total).toBe(0);
    });

    it("lists only deleted users when isDeleted=true is requested", async () => {
        const tx = makeClient();

        await UserService.getUsers(
            { page: "1", limit: "10", isDeleted: "true" },
            tx as unknown as Prisma.TransactionClient,
        );

        const findManyArgs = tx.user.findMany.mock.calls[0][0] as Record<string, unknown>;
        expect(findManyArgs.where).toEqual({ isDeleted: true });
    });
});

describe("getUserStats", () => {
    it("aggregates status and role counts from the database", async () => {
        const tx = makeClient();
        tx.user.groupBy
            .mockResolvedValueOnce([
                { status: "ACTIVE", _count: { _all: 5 } },
                { status: "BLOCKED", _count: { _all: 2 } },
            ] as never)
            .mockResolvedValueOnce([
                { role: Role.USER, _count: { _all: 6 } },
                { role: Role.ADMIN, _count: { _all: 1 } },
            ] as never);
        tx.user.count.mockResolvedValue(3);

        const stats = await UserService.getUserStats(
            tx as unknown as Prisma.TransactionClient,
        );

        expect(stats.total).toBe(7);
        expect(stats.active).toBe(5);
        expect(stats.blocked).toBe(2);
        expect(stats.deleted).toBe(3);
        expect(stats.byRole[Role.USER]).toBe(6);
        expect(stats.byRole[Role.SUPER_ADMIN]).toBe(0);
    });
});

describe("updateStatus", () => {
    it("prevents changing the status of your own account", async () => {
        const tx = makeClient({
            target: { id: "actor-1", role: Role.SUPER_ADMIN, status: "ACTIVE" },
        });
        await expect(
            UserService.updateStatus(
                "actor-1",
                { status: "BLOCKED" as never },
                actor(),
                tx as unknown as Prisma.TransactionClient,
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it("allows an ADMIN to block a regular USER", async () => {
        const tx = makeClient({
            target: { id: "u1", role: Role.USER, status: "ACTIVE" },
        });
        const result = await UserService.updateStatus(
            "u1",
            { status: "BLOCKED" as never },
            actor({ role: Role.ADMIN }),
            tx as unknown as Prisma.TransactionClient,
        );
        expect(result).toMatchObject({ status: "BLOCKED" });
    });

    it("prevents an ADMIN from changing another ADMIN's status", async () => {
        const tx = makeClient({
            target: { id: "admin2", role: Role.ADMIN, status: "ACTIVE" },
        });
        await expect(
            UserService.updateStatus(
                "admin2",
                { status: "BLOCKED" as never },
                actor({ role: Role.ADMIN }),
                tx as unknown as Prisma.TransactionClient,
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it("prevents an ADMIN from changing a SUPER_ADMIN's status (rule 4)", async () => {
        const tx = makeClient({
            target: { id: "sa", role: Role.SUPER_ADMIN, status: "ACTIVE" },
        });
        await expect(
            UserService.updateStatus(
                "sa",
                { status: "BLOCKED" as never },
                actor({ role: Role.ADMIN }),
                tx as unknown as Prisma.TransactionClient,
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it("allows a SUPER_ADMIN to change another SUPER_ADMIN's status", async () => {
        const tx = makeClient({
            target: { id: "sa2", role: Role.SUPER_ADMIN, status: "ACTIVE" },
        });
        const result = await UserService.updateStatus(
            "sa2",
            { status: "BLOCKED" as never },
            actor(),
            tx as unknown as Prisma.TransactionClient,
        );
        expect(result).toMatchObject({ status: "BLOCKED" });
    });
});

describe("changeRole", () => {
    it("prevents an ADMIN from promoting anyone to SUPER_ADMIN (rule 4)", async () => {
        const tx = makeClient({ target: { id: "u1", role: Role.EMPLOYEE } });
        await expect(
            UserService.changeRole(
                "u1",
                { role: Role.SUPER_ADMIN },
                actor({ role: Role.ADMIN }),
                tx as unknown as Prisma.TransactionClient,
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it("prevents an ADMIN from changing another ADMIN's role", async () => {
        const tx = makeClient({ target: { id: "admin2", role: Role.ADMIN } });
        await expect(
            UserService.changeRole(
                "admin2",
                { role: Role.MODERATOR },
                actor({ role: Role.ADMIN }),
                tx as unknown as Prisma.TransactionClient,
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it("prevents an ADMIN from promoting a MODERATOR to ADMIN (rule 6)", async () => {
        const tx = makeClient({ target: { id: "mod", role: Role.MODERATOR } });
        await expect(
            UserService.changeRole(
                "mod",
                { role: Role.ADMIN },
                actor({ role: Role.ADMIN }),
                tx as unknown as Prisma.TransactionClient,
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it("prevents changing your own role", async () => {
        const tx = makeClient({ target: { id: "actor-1", role: Role.ADMIN } });
        await expect(
            UserService.changeRole(
                "actor-1",
                { role: Role.MODERATOR },
                actor(),
                tx as unknown as Prisma.TransactionClient,
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it("allows SUPER_ADMIN to change an ADMIN to MODERATOR", async () => {
        const tx = makeClient();
        tx.user.findUnique
            .mockResolvedValueOnce({ id: "admin2", role: Role.ADMIN })
            .mockResolvedValue({ id: "admin2", role: Role.MODERATOR, status: "ACTIVE" } as never);

        const result = await UserService.changeRole(
            "admin2",
            { role: Role.MODERATOR },
            actor(),
            tx as unknown as Prisma.TransactionClient,
        );

        expect(tx.user.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: "admin2" },
                data: { role: Role.MODERATOR },
            }),
        );
        expect(tx.appUser.updateMany).not.toHaveBeenCalled();
        expect(result).toMatchObject({ role: Role.MODERATOR });
    });

    it("never touches canEarn when changing roles (agent status comes from approval)", async () => {
        const tx = makeClient();
        tx.user.findUnique
            .mockResolvedValueOnce({ id: "u1", role: Role.USER })
            .mockResolvedValue({ id: "u1", role: Role.MODERATOR } as never);

        const result = await UserService.changeRole(
            "u1",
            { role: Role.MODERATOR },
            actor(),
            tx as unknown as Prisma.TransactionClient,
        );

        expect(tx.appUser.updateMany).not.toHaveBeenCalled();
        expect(result).toMatchObject({ role: Role.MODERATOR });
    });

    it("allows a SUPER_ADMIN to change another SUPER_ADMIN's role", async () => {
        const tx = makeClient();
        tx.user.findUnique
            .mockResolvedValueOnce({ id: "sa2", role: Role.SUPER_ADMIN })
            .mockResolvedValue({ id: "sa2", role: Role.ADMIN, status: "ACTIVE" } as never);

        const result = await UserService.changeRole(
            "sa2",
            { role: Role.ADMIN },
            actor(),
            tx as unknown as Prisma.TransactionClient,
        );

        expect(result).toMatchObject({ role: Role.ADMIN });
    });
});

describe("softDeleteUser", () => {
    it("prevents an ADMIN from deleting a SUPER_ADMIN (rule 4)", async () => {
        const tx = makeClient({ target: { id: "sa", role: Role.SUPER_ADMIN } });
        await expect(
            UserService.softDeleteUser(
                "sa",
                actor({ role: Role.ADMIN }),
                tx as unknown as Prisma.TransactionClient,
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it("prevents an ADMIN from deleting another ADMIN", async () => {
        const tx = makeClient({ target: { id: "admin2", role: Role.ADMIN } });
        await expect(
            UserService.softDeleteUser(
                "admin2",
                actor({ role: Role.ADMIN }),
                tx as unknown as Prisma.TransactionClient,
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it("allows a SUPER_ADMIN to delete another SUPER_ADMIN (rule 3)", async () => {
        const tx = makeClient({ target: { id: "sa2", role: Role.SUPER_ADMIN } });

        const result = await UserService.softDeleteUser(
            "sa2",
            actor(),
            tx as unknown as Prisma.TransactionClient,
        );

        expect(tx.user.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: "sa2" },
                data: expect.objectContaining({ isDeleted: true }),
            }),
        );
        expect(result).toHaveProperty("deletedAt");
    });

    it("prevents deleting your own account", async () => {
        const tx = makeClient({ target: { id: "actor-1", role: Role.ADMIN } });
        await expect(
            UserService.softDeleteUser(
                "actor-1",
                actor(),
                tx as unknown as Prisma.TransactionClient,
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it("soft-deletes the user, their app_user and revokes sessions", async () => {
        const tx = makeClient({ target: { id: "u1", role: Role.USER } });

        const result = await UserService.softDeleteUser(
            "u1",
            actor(),
            tx as unknown as Prisma.TransactionClient,
        );

        expect(tx.user.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: "u1" },
                data: expect.objectContaining({ isDeleted: true }),
            }),
        );
        expect(tx.appUser.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { authUserId: "u1" },
                data: expect.objectContaining({ isDeleted: true }),
            }),
        );
        expect(tx.session.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
        expect(result).toHaveProperty("deletedAt");
    });
});

describe("restoreUser", () => {
    it("rejects restoring a user that is not deleted", async () => {
        const tx = makeClient({
            target: { id: "u1", role: Role.USER, isDeleted: false } as never,
        });

        await expect(
            UserService.restoreUser(
                "u1",
                actor(),
                tx as unknown as Prisma.TransactionClient,
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it("prevents an ADMIN from restoring a SUPER_ADMIN (rule 4)", async () => {
        const tx = makeClient({
            target: { id: "sa", role: Role.SUPER_ADMIN, isDeleted: true } as never,
        });

        await expect(
            UserService.restoreUser(
                "sa",
                actor({ role: Role.ADMIN }),
                tx as unknown as Prisma.TransactionClient,
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it("restores the user and their app profile", async () => {
        const tx = makeClient();
        tx.user.findUnique
            .mockResolvedValueOnce({ id: "u1", role: Role.USER, isDeleted: true } as never)
            .mockResolvedValue({ id: "u1", role: Role.USER, status: "ACTIVE" } as never);

        const result = await UserService.restoreUser(
            "u1",
            actor(),
            tx as unknown as Prisma.TransactionClient,
        );

        expect(tx.user.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: "u1" },
                data: expect.objectContaining({ isDeleted: false, status: "ACTIVE" }),
            }),
        );
        expect(tx.appUser.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { authUserId: "u1" },
                data: expect.objectContaining({ isDeleted: false }),
            }),
        );
        expect(result).toMatchObject({ status: "ACTIVE" });
    });
});