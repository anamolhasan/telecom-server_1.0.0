import { afterEach, describe, expect, it, vi } from "vitest";
import status from "http-status";
import { Role, UserStatus } from "../../generated/prisma/enums";
import { ROLE_ACCESS_MANAGERS } from "../constants/rbac.constant";
import { envVars } from "../config/env";
import { jwtUtils } from "../utils/jwt";
import { checkAuth } from "./checkAuth";

const mocks = vi.hoisted(() => ({
    findFirst: vi.fn(),
}));

vi.mock("../lib/prisma", () => ({
    prisma: {
        session: {
            findFirst: mocks.findFirst,
        },
    },
}));

// The exact guard used by GET /api/v1/role-access.
const roleAccessGuard = checkAuth(...ROLE_ACCESS_MANAGERS);

const buildAccessToken = (role: Role) =>
    jwtUtils.createToken(
        { userId: "u-1", role, email: "u@x.com" },
        envVars.ACCESS_TOKEN_SECRET,
        { expiresIn: "1h" },
    );

const buildRequest = (role: Role) =>
    ({
        cookies: {
            "better-auth.session_token": "session-token",
            accessToken: buildAccessToken(role),
        },
    }) as never;

const buildSession = (role: Role, userOverrides: Record<string, unknown> = {}) => ({
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    createdAt: new Date(Date.now() - 60 * 60 * 1000),
    user: {
        id: "u-1",
        role,
        email: "u@x.com",
        status: UserStatus.ACTIVE,
        isDeleted: false,
        ...userOverrides,
    },
});

const runGuard = async (role: Role, userOverrides: Record<string, unknown> = {}) => {
    mocks.findFirst.mockResolvedValue(buildSession(role, userOverrides));
    const next = vi.fn();
    const res = { setHeader: vi.fn() };

    await roleAccessGuard(buildRequest(role), res as never, next);

    return next;
};

afterEach(() => {
    vi.clearAllMocks();
});

describe("checkAuth on the Role Access Management API", () => {
    it("allows a SUPER_ADMIN", async () => {
        const next = await runGuard(Role.SUPER_ADMIN);

        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith();
    });

    it.each([Role.ADMIN, Role.MODERATOR, Role.SUPPORTER, Role.EMPLOYEE, Role.USER])(
        "denies %s with 403",
        async (role) => {
            const next = await runGuard(role);

            expect(next).toHaveBeenCalledTimes(1);
            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ statusCode: status.FORBIDDEN }),
            );
        },
    );

    it("denies an approved agent (USER with canEarn) with 403", async () => {
        // AGENT is not a Role; an approved agent is a USER granted canEarn, so it
        // is denied just like any other USER.
        const next = await runGuard(Role.USER, { canEarn: true });

        expect(next).toHaveBeenCalledWith(
            expect.objectContaining({ statusCode: status.FORBIDDEN }),
        );
    });

    it("returns 401 when no session token is provided", async () => {
        const next = vi.fn();
        const res = { setHeader: vi.fn() };

        await roleAccessGuard({ cookies: {} } as never, res as never, next);

        expect(next).toHaveBeenCalledWith(
            expect.objectContaining({ statusCode: status.UNAUTHORIZED }),
        );
        expect(mocks.findFirst).not.toHaveBeenCalled();
    });

    it("returns 401 when the session token is invalid", async () => {
        mocks.findFirst.mockResolvedValue(null);
        const next = vi.fn();
        const res = { setHeader: vi.fn() };

        await roleAccessGuard(
            buildRequest(Role.SUPER_ADMIN),
            res as never,
            next,
        );

        expect(next).toHaveBeenCalledWith(
            expect.objectContaining({ statusCode: status.UNAUTHORIZED }),
        );
    });
});
