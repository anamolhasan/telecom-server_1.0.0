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
        },
        user: { delete: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
        $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
        user: { delete: vi.fn().mockResolvedValue({}) },
    };
    const authMock = { api: { signUpEmail: vi.fn() } };
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

afterEach(() => {
    vi.clearAllMocks();
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