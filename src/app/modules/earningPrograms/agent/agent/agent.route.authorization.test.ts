import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import cookieParser from "cookie-parser";
import { Role, UserStatus } from "../../../../../generated/prisma/enums";
import { envVars } from "../../../../config/env";
import { ALL_ROLES } from "../../../../constants/rbac.constant";
import { globalErrorHandler } from "../../../../middleware/globalErrorHandler";
import { IndexRouters } from "../../../../routes";
import { jwtUtils } from "../../../../utils/jwt";

const mocks = vi.hoisted(() => ({
    sessionFindFirst: vi.fn(),
    appUserFindUnique: vi.fn(),
    getAgentDashboard: vi.fn(),
    getMySales: vi.fn(),
    getMyEarnings: vi.fn(),
}));

vi.mock("../../../../lib/prisma", () => ({
    prisma: {
        session: { findFirst: mocks.sessionFindFirst },
        appUser: { findUnique: mocks.appUserFindUnique },
    },
}));

vi.mock("./agent.service", () => ({
    AgentService: {
        getAgentDashboard: mocks.getAgentDashboard,
        getMySales: mocks.getMySales,
    },
}));

vi.mock("../../../earning/earning.service", () => ({
    EarningService: { getMyEarnings: mocks.getMyEarnings },
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

const app = express();
app.use(cookieParser());
app.use(express.json());
app.use(IndexRouters);
app.use(globalErrorHandler);

let server: Server;
let baseUrl: string;

const request = async (
    path: string,
    role?: Role,
): Promise<{ status: number; body: { success: boolean; message: string } }> => {
    const headers: Record<string, string> = {};

    if (role) {
        mocks.sessionFindFirst.mockResolvedValue(buildSession(role));
        headers.Cookie = buildCookieHeader(role);
    }

    const response = await fetch(`${baseUrl}${path}`, { headers });

    return { status: response.status, body: await response.json() };
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
    mocks.getAgentDashboard.mockResolvedValue({ program: "AGENT" });
    mocks.getMySales.mockResolvedValue({
        data: [],
        meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
    });
    mocks.getMyEarnings.mockResolvedValue({
        data: [],
        meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
    });
});

describe("agent dashboard access", () => {
    it.each(ALL_ROLES)("lets a %s view its agent dashboard", async (role) => {
        const { status } = await request("/agent/dashboard", role);

        expect(status).toBe(200);
        expect(mocks.getAgentDashboard).toHaveBeenCalledWith(
            expect.objectContaining({ userId: "u-1", role }),
        );
    });

    it("rejects an anonymous dashboard read", async () => {
        const { status } = await request("/agent/dashboard");

        expect(status).toBe(401);
        expect(mocks.getAgentDashboard).not.toHaveBeenCalled();
    });
});

describe("approved-agent-only access", () => {
    const approved = {
        id: "app-1",
        agentApplication: { status: "APPROVED" },
        affiliateApplication: { status: "PENDING" },
        referralApplication: null,
    };

    beforeEach(() => {
        mocks.appUserFindUnique.mockResolvedValue(approved);
    });

    it.each(ALL_ROLES)(
        "lets an approved %s agent read its own sales and earnings",
        async (role) => {
            const sales = await request("/agent/sales", role);
            const earnings = await request("/agent/earnings", role);

            expect(sales.status).toBe(200);
            expect(earnings.status).toBe(200);
            // Earning history for this program is forced server-side.
            expect(mocks.getMyEarnings).toHaveBeenCalledWith(
                expect.objectContaining({ userId: "u-1" }),
                expect.anything(),
                expect.objectContaining({ program: "AGENT" }),
            );
        },
    );

    it("forbids an account whose agent application is not approved", async () => {
        mocks.appUserFindUnique.mockResolvedValue({
            id: "app-1",
            agentApplication: { status: "PENDING" },
            affiliateApplication: { status: "APPROVED" },
            referralApplication: null,
        });

        const sales = await request("/agent/sales", Role.USER);

        // An approved Affiliate application must never unlock Agent access.
        expect(sales.status).toBe(403);
        expect(mocks.getMySales).not.toHaveBeenCalled();
    });

    it("forbids an account with no agent application", async () => {
        mocks.appUserFindUnique.mockResolvedValue({
            id: "app-1",
            agentApplication: null,
            affiliateApplication: null,
            referralApplication: null,
        });

        const { status } = await request("/agent/sales", Role.ADMIN);

        expect(status).toBe(403);
        expect(mocks.getMySales).not.toHaveBeenCalled();
    });

    it("rejects an anonymous sales read", async () => {
        const { status } = await request("/agent/sales");

        expect(status).toBe(401);
        expect(mocks.getMySales).not.toHaveBeenCalled();
    });
});
