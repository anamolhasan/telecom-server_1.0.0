import { afterEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "../../../generated/prisma/client";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../lib/auth";
import { UserService } from "./user.service";

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

    it("rejects staff account creation by an AGENT", async () => {
        const tx = makeClient();
        await expect(
            UserService.createStaffAccount(
                { name: "Supporter", email: "sup@x.com", password: "secret1", role: Role.SUPPORTER },
                actor({ role: Role.AGENT }),
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
                body: expect.objectContaining({ role: Role.SUPER_ADMIN }),
            }),
        );
        expect(tx.appUser.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ authUserId: "u-sa2", canEarn: false }),
            }),
        );
    });

    it("prevents directly creating an AGENT (AGENT comes from an Application approval, rule 8)", async () => {
        const tx = makeClient();
        await expect(
            UserService.createStaffAccount(
                { name: "Agent", email: "agent@x.com", password: "secret1", role: Role.AGENT },
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
                body: expect.objectContaining({ role: Role.ADMIN, needPasswordChange: true }),
            }),
        );
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

    it("sets canEarn when promoting a USER to AGENT", async () => {
        const tx = makeClient();
        tx.user.findUnique
            .mockResolvedValueOnce({ id: "u1", role: Role.USER })
            .mockResolvedValue({ id: "u1", role: Role.AGENT } as never);

        const result = await UserService.changeRole(
            "u1",
            { role: Role.AGENT },
            actor(),
            tx as unknown as Prisma.TransactionClient,
        );

        expect(tx.appUser.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { authUserId: "u1" },
                data: { canEarn: true },
            }),
        );
        expect(result).toMatchObject({ role: Role.AGENT });
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