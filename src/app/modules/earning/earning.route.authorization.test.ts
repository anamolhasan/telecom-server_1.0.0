import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import cookieParser from "cookie-parser";
import { Role, UserStatus } from "../../../generated/prisma/enums";
import { envVars } from "../../config/env";
import { ALL_ROLES, FINANCE_ROLES } from "../../constants/rbac.constant";
import { globalErrorHandler } from "../../middleware/globalErrorHandler";
import { IndexRouters } from "../../routes";
import { jwtUtils } from "../../utils/jwt";

// The real route -> guard -> controller pipeline is exercised against a mocked
// Prisma session lookup and a mocked EarningService, so the authorization wiring
// (which roles reach which earning handler) is what is under test.
const mocks = vi.hoisted(() => ({
    sessionFindFirst: vi.fn(),
    getMyEarnings: vi.fn(),
    getMyEarningSummary: vi.fn(),
    createCommissionRule: vi.fn(),
    listCommissionRules: vi.fn(),
    updateCommissionRule: vi.fn(),
}));

vi.mock("../../lib/prisma", () => ({
    prisma: { session: { findFirst: mocks.sessionFindFirst } },
}));

vi.mock("./earning.service", () => ({
    EarningService: {
        getMyEarnings: mocks.getMyEarnings,
        getMyEarningSummary: mocks.getMyEarningSummary,
        createCommissionRule: mocks.createCommissionRule,
        listCommissionRules: mocks.listCommissionRules,
        updateCommissionRule: mocks.updateCommissionRule,
    },
}));

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

const buildCookieHeader = (role: Role) => {
    const accessToken = jwtUtils.createToken(
        { userId: "u-1", role, email: "u@x.com" },
        envVars.ACCESS_TOKEN_SECRET,
        { expiresIn: "1h" },
    );

    return [
        "better-auth.session_token=session-token",
        `accessToken=${accessToken}`,
    ].join("; ");
};

interface ApiBody {
    success: boolean;
    message: string;
    data?: unknown;
    meta?: unknown;
}

const app = express();
app.use(cookieParser());
app.use(express.json());
app.use(IndexRouters);
app.use(globalErrorHandler);

let server: Server;
let baseUrl: string;

const request = async (
    method: string,
    path: string,
    options: { role?: Role; body?: unknown } = {},
): Promise<{ status: number; body: ApiBody }> => {
    const headers: Record<string, string> = {};

    if (options.body !== undefined) {
        headers["Content-Type"] = "application/json";
    }

    if (options.role) {
        mocks.sessionFindFirst.mockResolvedValue(buildSession(options.role));
        headers.Cookie = buildCookieHeader(options.role);
    }

    const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body:
            options.body === undefined
                ? undefined
                : JSON.stringify(options.body),
    });

    return { status: response.status, body: (await response.json()) as ApiBody };
};

beforeAll(async () => {
    await new Promise<void>((resolve) => {
        server = app.listen(0, () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    });
});

beforeEach(() => {
    vi.resetAllMocks();
    mocks.getMyEarnings.mockResolvedValue({
        data: [],
        meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
    });
    mocks.getMyEarningSummary.mockResolvedValue({
        programs: [],
        pendingTotal: 0,
        availableTotal: 0,
        reversedTotal: 0,
        walletBalance: 0,
        totalEarned: 0,
    });
    mocks.listCommissionRules.mockResolvedValue({
        data: [],
        meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
    });
});

describe("earning history access", () => {
    it.each(ALL_ROLES)("lets a %s read their own earnings", async (role) => {
        const { status, body } = await request("GET", "/earnings/me", { role });

        expect(status).toBe(200);
        expect(body.success).toBe(true);
        // Earnings are keyed off the session user, never a request parameter.
        expect(mocks.getMyEarnings).toHaveBeenCalledWith(
            expect.objectContaining({ userId: "u-1", role }),
            expect.anything(),
        );
    });

    it.each(ALL_ROLES)("lets a %s read their own earning summary", async (role) => {
        const { status } = await request("GET", "/earnings/me/summary", { role });

        expect(status).toBe(200);
        expect(mocks.getMyEarningSummary).toHaveBeenCalledWith(
            expect.objectContaining({ userId: "u-1", role }),
        );
    });

    it("rejects an anonymous earnings read", async () => {
        const { status } = await request("GET", "/earnings/me");

        expect(status).toBe(401);
        expect(mocks.getMyEarnings).not.toHaveBeenCalled();
    });
});

describe("commission rule access", () => {
    it.each(FINANCE_ROLES)("lets a %s list commission rules", async (role) => {
        const { status } = await request("GET", "/earnings/rules", { role });

        expect(status).toBe(200);
        expect(mocks.listCommissionRules).toHaveBeenCalled();
    });

    it.each([Role.MODERATOR, Role.SUPPORTER, Role.EMPLOYEE, Role.USER])(
        "forbids a %s from reading commission configuration",
        async (role) => {
            const { status } = await request("GET", "/earnings/rules", { role });

            expect(status).toBe(403);
            expect(mocks.listCommissionRules).not.toHaveBeenCalled();
        },
    );

    it.each([Role.MODERATOR, Role.SUPPORTER, Role.EMPLOYEE, Role.USER])(
        "forbids a %s from creating a commission rule",
        async (role) => {
            const { status } = await request("POST", "/earnings/rules", {
                role,
                body: {
                    program: "AGENT",
                    scope: "GLOBAL",
                    ruleType: "FIXED",
                    value: 10,
                },
            });

            expect(status).toBe(403);
            expect(mocks.createCommissionRule).not.toHaveBeenCalled();
        },
    );

    it("rejects an anonymous commission rule write", async () => {
        const { status } = await request("POST", "/earnings/rules", {
            body: {
                program: "AGENT",
                scope: "GLOBAL",
                ruleType: "FIXED",
                value: 10,
            },
        });

        expect(status).toBe(401);
        expect(mocks.createCommissionRule).not.toHaveBeenCalled();
    });

    it("lets a finance admin create a commission rule", async () => {
        mocks.createCommissionRule.mockResolvedValue({ id: "rule-1" });

        const { status } = await request("POST", "/earnings/rules", {
            role: Role.ADMIN,
            body: {
                program: "AFFILIATE",
                scope: "PRODUCT",
                ruleType: "PERCENTAGE",
                value: 5,
                productId: "p1",
            },
        });

        expect(status).toBe(201);
        expect(mocks.createCommissionRule).toHaveBeenCalledWith(
            expect.objectContaining({ userId: "u-1", role: Role.ADMIN }),
            expect.objectContaining({ program: "AFFILIATE", productId: "p1" }),
        );
    });

    it("rejects an invalid commission rule body before it reaches the service", async () => {
        const { status } = await request("POST", "/earnings/rules", {
            role: Role.ADMIN,
            body: {
                program: "AGENT",
                scope: "GLOBAL",
                ruleType: "FIXED",
                value: -5,
            },
        });

        expect(status).toBe(400);
        expect(mocks.createCommissionRule).not.toHaveBeenCalled();
    });

    it("forbids a customer from updating a commission rule", async () => {
        const { status } = await request("PATCH", "/earnings/rules/rule-1", {
            role: Role.USER,
            body: { value: 999 },
        });

        expect(status).toBe(403);
        expect(mocks.updateCommissionRule).not.toHaveBeenCalled();
    });
});
