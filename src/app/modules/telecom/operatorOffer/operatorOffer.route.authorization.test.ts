import { afterEach, describe, expect, it, vi } from "vitest";
import status from "http-status";
import { Role, UserStatus } from "../../../../generated/prisma/enums";
import { envVars } from "../../../config/env";
import { CONTENT_ADMIN_ROLES } from "../../../constants/rbac.constant";
import { jwtUtils } from "../../../utils/jwt";
import { checkAuth } from "../../../middleware/checkAuth";

const mocks = vi.hoisted(() => ({
    findFirst: vi.fn(),
}));

vi.mock("../../../lib/prisma", () => ({
    prisma: {
        session: {
            findFirst: mocks.findFirst,
        },
    },
}));

// The exact guard protecting OperatorOffer create/update/status/archive routes.
const operatorOfferWriteGuard = checkAuth(...CONTENT_ADMIN_ROLES);

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

const buildSession = (role: Role) => ({
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    createdAt: new Date(Date.now() - 60 * 60 * 1000),
    user: {
        id: "u-1",
        role,
        email: "u@x.com",
        status: UserStatus.ACTIVE,
        isDeleted: false,
    },
});

const runGuard = async (role: Role) => {
    mocks.findFirst.mockResolvedValue(buildSession(role));
    const next = vi.fn();
    const res = { setHeader: vi.fn() };

    await operatorOfferWriteGuard(buildRequest(role), res as never, next);

    return next;
};

afterEach(() => {
    vi.clearAllMocks();
});

describe("checkAuth on the Operator Offer write APIs", () => {
    it.each([Role.SUPER_ADMIN, Role.ADMIN])("allows %s", async (role) => {
        const next = await runGuard(role);

        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith();
    });

    it.each([Role.MODERATOR, Role.SUPPORTER, Role.EMPLOYEE, Role.USER])(
        "denies %s with 403",
        async (role) => {
            const next = await runGuard(role);

            expect(next).toHaveBeenCalledTimes(1);
            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ statusCode: status.FORBIDDEN }),
            );
        },
    );

    it("returns 401 when no session token is provided", async () => {
        const next = vi.fn();
        const res = { setHeader: vi.fn() };

        await operatorOfferWriteGuard({ cookies: {} } as never, res as never, next);

        expect(next).toHaveBeenCalledWith(
            expect.objectContaining({ statusCode: status.UNAUTHORIZED }),
        );
        expect(mocks.findFirst).not.toHaveBeenCalled();
    });
});
