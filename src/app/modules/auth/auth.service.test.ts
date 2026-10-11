import { afterEach, describe, expect, it, vi } from "vitest";
import { Role } from "../../../generated/prisma/enums";
import { AuthService } from "./auth.service";
import { AuthValidation } from "./auth.validation";

const mocks = vi.hoisted(() => {
    const tx = {
        appUser: {
            create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
                id: "app1",
                ...args.data,
            })),
            updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        user: {
            delete: vi.fn().mockResolvedValue({}),
            update: vi.fn(),
        },
    };
    const prisma = {
        $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
        user: {
            delete: vi.fn().mockResolvedValue({}),
            findUnique: vi.fn(),
            update: vi.fn(),
        },
    };
    const authMock = {
        api: {
            signUpEmail: vi.fn(),
            changePassword: vi.fn(),
        },
    };
    return { tx, prisma, authMock };
});

vi.mock("../../lib/auth", () => ({ auth: mocks.authMock }));
vi.mock("../../lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("../../utils/token", () => ({
    tokenUtils: {
        getAccessToken: vi.fn(() => "access-token"),
        getRefreshToken: vi.fn(() => "refresh-token"),
    },
}));

const signUpEmailMock = mocks.authMock.api.signUpEmail;
const changePasswordMock = mocks.authMock.api.changePassword;

afterEach(() => {
    vi.clearAllMocks();
});

describe("getMe (current authenticated user)", () => {
    it("resolves the profile from the authenticated request (never a client-supplied id)", async () => {
        const profile = {
            id: "u1",
            name: "Mehedi",
            email: "mehedi@x.com",
            phone: null,
            emailVerified: true,
            phoneVerified: false,
            role: Role.USER,
            status: "ACTIVE",
            createdAt: new Date("2024-01-01T00:00:00Z").toISOString(),
            updatedAt: new Date("2024-01-02T00:00:00Z").toISOString(),
            appUser: {
                id: "app1",
                balance: 10,
                totalEarned: 5,
                canEarn: false,
            },
        };
        mocks.prisma.user.findUnique.mockResolvedValue(profile);

        const result = await AuthService.getMe({
            userId: "u1",
            role: Role.USER,
            email: "mehedi@x.com",
        });

        expect(mocks.prisma.user.findUnique).toHaveBeenCalledWith({
            where: { id: "u1" },
            include: { appUser: true },
        });
        expect(result).toEqual(profile);
        expect(profile).not.toHaveProperty("password");
        expect(profile).not.toHaveProperty("refreshToken");
    });

    it("throws NOT_FOUND when the authenticated user no longer exists", async () => {
        mocks.prisma.user.findUnique.mockResolvedValue(null);

        await expect(
            AuthService.getMe({ userId: "ghost", role: Role.USER, email: "g@x.com" }),
        ).rejects.toMatchObject({
            statusCode: 404,
            message: "User not found",
        });
    });
});

describe("updateMe (self-service profile update)", () => {
    it("updates the authenticated user (server context) and never trusts a client id", async () => {
        const profile = {
            id: "u1",
            name: "Old Name",
            email: "mehedi@x.com",
            phone: null,
            emailVerified: true,
            phoneVerified: false,
            role: Role.USER,
            status: "ACTIVE",
            appUser: { id: "app1", balance: 10, totalEarned: 5, canEarn: false },
        };
        // updateProfile target read + post-update read (Old Name persisted value),
        // then getMe re-read (New Name, the persisted result).
        mocks.prisma.user.findUnique
            .mockResolvedValueOnce(profile)
            .mockResolvedValueOnce(profile)
            .mockResolvedValue({ ...profile, name: "New Name" });
        mocks.tx.user.update.mockResolvedValue({ ...profile, name: "New Name" });
        mocks.tx.appUser.updateMany.mockResolvedValue({ count: 1 });

        const result = await AuthService.updateMe(
            { userId: "u1", role: Role.USER, email: "mehedi@x.com" },
            { name: "New Name", contactNumber: "01700000000" },
        );

        // The target is always derived from the authenticated request, not the payload.
        expect(mocks.prisma.user.findUnique).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: "u1" } }),
        );
        expect(mocks.tx.user.update).toHaveBeenCalledWith({
            where: { id: "u1" },
            data: expect.objectContaining({ name: "New Name" }),
        });
        const userData = mocks.tx.user.update.mock.calls[0][0].data;
        expect(userData).not.toHaveProperty("role");
        expect(userData).not.toHaveProperty("status");
        expect(userData).not.toHaveProperty("email");

        expect(mocks.tx.appUser.updateMany).toHaveBeenCalledWith({
            where: { authUserId: "u1" },
            data: expect.objectContaining({ contactNumber: "01700000000" }),
        });
        const appUserData = mocks.tx.appUser.updateMany.mock.calls[0][0].data;
        expect(appUserData).not.toHaveProperty("balance");
        expect(appUserData).not.toHaveProperty("totalEarned");
        expect(appUserData).not.toHaveProperty("canEarn");
        expect(appUserData).not.toHaveProperty("referredBy");

        expect(result.name).toBe("New Name");
    });

    it("throws NOT_FOUND when the authenticated user no longer exists", async () => {
        mocks.prisma.user.findUnique.mockResolvedValue(null);

        await expect(
            AuthService.updateMe(
                { userId: "ghost", role: Role.USER, email: "g@x.com" },
                { name: "Ghost" },
            ),
        ).rejects.toMatchObject({
            statusCode: 404,
            message: "User not found.",
        });
    });
});

describe("updateProfileZodSchema (self-service)", () => {
    it("strips privileged fields such as role, status, balance and canEarn", () => {
        const parsed = AuthValidation.updateProfileZodSchema.safeParse({
            name: "Mehedi",
            phone: "01700000000",
            contactNumber: "01700000000",
            address: "Dhaka",
            country: "Bangladesh",
            role: Role.SUPER_ADMIN,
            status: "BLOCKED",
            balance: 9999,
            canEarn: true,
            referredBy: "someone",
            email: "attacker@x.com",
        });

        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(parsed.data).toHaveProperty("name");
            expect(parsed.data).not.toHaveProperty("role");
            expect(parsed.data).not.toHaveProperty("status");
            expect(parsed.data).not.toHaveProperty("balance");
            expect(parsed.data).not.toHaveProperty("canEarn");
            expect(parsed.data).not.toHaveProperty("referredBy");
            expect(parsed.data).not.toHaveProperty("email");
        }
    });
});

describe("registerUser (public registration)", () => {
    it("creates a plain USER and never passes a role to better-auth", async () => {
        const payload = { name: "Mehedi", email: "mehedi@x.com", password: "secret1" };
        signUpEmailMock.mockResolvedValue({
            user: { id: "u1", role: Role.USER, name: payload.name, email: payload.email },
            token: "session-token",
        });

        const result = await AuthService.registerUser(payload);

        expect(signUpEmailMock).toHaveBeenCalledTimes(1);
        const body = signUpEmailMock.mock.calls[0][0].body;
        expect(body).toEqual(payload);
        expect(body).not.toHaveProperty("role");
        expect(result.user.role).toBe(Role.USER);
        expect(mocks.tx.appUser.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ authUserId: "u1" }),
            }),
        );
    });

    it("ignores privileged fields such as role and isSuperAdmin in the public payload", async () => {
        const payload = { name: "Attacker", email: "a@x.com", password: "secret1" };
        signUpEmailMock.mockResolvedValue({
            user: { id: "u2", role: Role.USER, name: payload.name, email: payload.email },
        });

        const result = await AuthService.registerUser(
            { ...payload, role: Role.SUPER_ADMIN, isSuperAdmin: true } as never,
        );

        const body = signUpEmailMock.mock.calls[0][0].body;
        expect(body).toEqual(payload);
        expect(body).not.toHaveProperty("role");
        expect(body).not.toHaveProperty("isSuperAdmin");
        expect(result.user.role).toBe(Role.USER);
    });

    it("strips privileged fields at the validation layer", () => {
        const parsed = AuthValidation.registerAppUserZodSchema.safeParse({
            name: "Mehedi",
            email: "mehedi@x.com",
            password: "secret1",
            role: Role.SUPER_ADMIN,
            isAdmin: true,
        });

        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(parsed.data).not.toHaveProperty("role");
            expect(parsed.data).not.toHaveProperty("isAdmin");
        }
    });
});

describe("changePassword (self-service)", () => {
    const sessionToken = "raw-session-token";
    const user = { userId: "u1", role: Role.USER, email: "mehedi@x.com" };

    it("rejects the request when no session token is present", async () => {
        await expect(
            AuthService.changePassword(
                { currentPassword: "oldpass", newPassword: "newpass1" },
                undefined,
                user,
            ),
        ).rejects.toMatchObject({ statusCode: 401 });
        expect(changePasswordMock).not.toHaveBeenCalled();
    });

    it("delegates to better-auth with a bearer header, revokes other sessions and clears the flag", async () => {
        changePasswordMock.mockResolvedValue({
            token: "new-session-token",
            user: { id: "u1" },
        });
        mocks.prisma.user.findUnique.mockResolvedValue({
            id: "u1",
            name: "Mehedi",
            needPasswordChange: true,
        });
        mocks.prisma.user.update.mockResolvedValue({ id: "u1" });

        const result = await AuthService.changePassword(
            { currentPassword: "oldpass", newPassword: "newpass1" },
            sessionToken,
            user,
        );

        expect(changePasswordMock).toHaveBeenCalledTimes(1);
        const call = changePasswordMock.mock.calls[0][0];
        expect(call.body).toEqual({
            currentPassword: "oldpass",
            newPassword: "newpass1",
            revokeOtherSessions: true,
        });
        // Raw token is exchanged through better-auth's bearer plugin (no manual signing).
        expect(call.headers.get("authorization")).toBe(`Bearer ${sessionToken}`);

        // Target identity comes from the session context, never the payload.
        expect(mocks.prisma.user.update).toHaveBeenCalledWith({
            where: { id: "u1" },
            data: { needPasswordChange: false },
        });

        expect(result.token).toBe("new-session-token");
        expect(result.accessToken).toBe("access-token");
        expect(result.refreshToken).toBe("refresh-token");
        expect(result).not.toHaveProperty("password");
    });

    it("does not touch needPasswordChange when the flag is already false", async () => {
        changePasswordMock.mockResolvedValue({ token: "t", user: { id: "u1" } });
        mocks.prisma.user.findUnique.mockResolvedValue({
            id: "u1",
            name: "Mehedi",
            needPasswordChange: false,
        });

        await AuthService.changePassword(
            { currentPassword: "oldpass", newPassword: "newpass1" },
            sessionToken,
            user,
        );

        expect(mocks.prisma.user.update).not.toHaveBeenCalled();
    });

    it("maps an incorrect current password to a clean 400 message", async () => {
        changePasswordMock.mockRejectedValue({
            statusCode: 400,
            body: { code: "INVALID_PASSWORD", message: "Invalid password" },
        });

        await expect(
            AuthService.changePassword(
                { currentPassword: "wrong", newPassword: "newpass1" },
                sessionToken,
                user,
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            message: "Current password is incorrect.",
        });
    });

    it("does not leak internal error details for unexpected failures", async () => {
        changePasswordMock.mockRejectedValue(
            new Error("connection to database at 10.0.0.5 refused"),
        );

        await expect(
            AuthService.changePassword(
                { currentPassword: "oldpass", newPassword: "newpass1" },
                sessionToken,
                user,
            ),
        ).rejects.toMatchObject({
            statusCode: 500,
            message: "Failed to change password. Please try again.",
        });
    });
});