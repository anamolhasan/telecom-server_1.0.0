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
    getAffiliateDashboard: vi.fn(),
    createLink: vi.fn(),
    getMyLinks: vi.fn(),
    updateMyLink: vi.fn(),
    trackVisit: vi.fn(),
    getMyConversions: vi.fn(),
    getMyEarnings: vi.fn(),
}));

vi.mock("../../../../lib/prisma", () => ({
    prisma: {
        session: { findFirst: mocks.sessionFindFirst },
        appUser: { findUnique: mocks.appUserFindUnique },
    },
}));

vi.mock("./affiliate.service", () => ({
    AffiliateService: {
        getAffiliateDashboard: mocks.getAffiliateDashboard,
        createLink: mocks.createLink,
        getMyLinks: mocks.getMyLinks,
        updateMyLink: mocks.updateMyLink,
        trackVisit: mocks.trackVisit,
        getMyConversions: mocks.getMyConversions,
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
    options: { role?: Role; method?: string; body?: unknown } = {},
): Promise<{ status: number; body: { success: boolean; message: string } }> => {
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
    };

    if (options.role) {
        mocks.sessionFindFirst.mockResolvedValue(buildSession(options.role));
        headers.Cookie = buildCookieHeader(options.role);
    }

    const response = await fetch(`${baseUrl}${path}`, {
        method: options.method ?? "GET",
        headers,
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });

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
    mocks.getAffiliateDashboard.mockResolvedValue({ program: "AFFILIATE" });
    mocks.getMyLinks.mockResolvedValue({
        data: [],
        meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
    });
    mocks.getMyConversions.mockResolvedValue({
        data: [],
        meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
    });
    mocks.getMyEarnings.mockResolvedValue({
        data: [],
        meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
    });
    mocks.trackVisit.mockResolvedValue({
        attributed: true,
        existing: false,
        reason: null,
        affiliateLinkId: "link-1",
        productId: "p1",
        attributedAt: new Date("2026-10-18"),
    });
});

describe("affiliate dashboard access", () => {
    it.each(ALL_ROLES)("lets a %s view its affiliate dashboard", async (role) => {
        const { status } = await request("/affiliate/dashboard", { role });

        expect(status).toBe(200);
        expect(mocks.getAffiliateDashboard).toHaveBeenCalledWith(
            expect.objectContaining({ userId: "u-1", role }),
        );
    });

    it("rejects an anonymous dashboard read", async () => {
        const { status } = await request("/affiliate/dashboard");

        expect(status).toBe(401);
    });

    // Regression guard: the dashboard/overview must stay open before approval.
    // Only the approved-only sub-resources are gated.
    it.each([{ status: "PENDING" }, { status: "REJECTED" }])(
        "serves the dashboard to an applicant whose application is $status",
        async (application) => {
            mocks.appUserFindUnique.mockResolvedValue({
                id: "app-1",
                affiliateApplication: application,
                agentApplication: null,
                referralApplication: null,
            });

            const { status } = await request("/affiliate/dashboard", {
                role: Role.USER,
            });

            expect(status).toBe(200);
            expect(mocks.getAffiliateDashboard).toHaveBeenCalledTimes(1);
        },
    );
});

describe("affiliate attribution access", () => {
    it.each(ALL_ROLES)(
        "lets any authenticated %s record a visit",
        async (role) => {
            const { status } = await request("/affiliate/visit", {
                role,
                method: "POST",
                body: { code: "PERMANENT01", productId: "p1" },
            });

            expect(status).toBe(200);
            expect(mocks.trackVisit).toHaveBeenCalledWith(
                expect.objectContaining({ userId: "u-1" }),
                expect.objectContaining({ code: "PERMANENT01", productId: "p1" }),
            );
        },
    );

    it("rejects an anonymous visit", async () => {
        const { status } = await request("/affiliate/visit", {
            method: "POST",
            body: { code: "PERMANENT01", productId: "p1" },
        });

        expect(status).toBe(401);
        expect(mocks.trackVisit).not.toHaveBeenCalled();
    });

    it("rejects a visit without a code", async () => {
        const { status } = await request("/affiliate/visit", {
            role: Role.USER,
            method: "POST",
            body: { productId: "p1" },
        });

        expect(status).toBe(400);
        expect(mocks.trackVisit).not.toHaveBeenCalled();
    });
});

describe("approved-affiliate-only access", () => {
    const approved = {
        id: "app-1",
        affiliateApplication: { status: "APPROVED" },
        agentApplication: { status: "PENDING" },
        referralApplication: null,
    };

    beforeEach(() => {
        mocks.appUserFindUnique.mockResolvedValue(approved);
        mocks.createLink.mockResolvedValue({ id: "link-1" });
        mocks.updateMyLink.mockResolvedValue({ id: "link-1" });
    });

    it.each(ALL_ROLES)(
        "lets an approved %s affiliate manage its own links and read its earnings",
        async (role) => {
            const links = await request("/affiliate/links", { role });
            const created = await request("/affiliate/links", {
                role,
                method: "POST",
                body: { productId: "p1" },
            });
            const updated = await request("/affiliate/links/link-1", {
                role,
                method: "PATCH",
                body: { isActive: false },
            });
            const conversions = await request("/affiliate/conversions", { role });
            const earnings = await request("/affiliate/earnings", { role });

            expect(links.status).toBe(200);
            expect(created.status).toBe(201);
            expect(updated.status).toBe(200);
            expect(conversions.status).toBe(200);
            expect(earnings.status).toBe(200);
            // Earning history for this program is forced server-side.
            expect(mocks.getMyEarnings).toHaveBeenCalledWith(
                expect.objectContaining({ userId: "u-1" }),
                expect.anything(),
                expect.objectContaining({ program: "AFFILIATE" }),
            );
            expect(mocks.updateMyLink).toHaveBeenCalledWith(
                expect.objectContaining({ userId: "u-1" }),
                "link-1",
                expect.objectContaining({ isActive: false }),
            );
        },
    );

    it("forbids an account whose affiliate application is not approved", async () => {
        mocks.appUserFindUnique.mockResolvedValue({
            id: "app-1",
            affiliateApplication: { status: "PENDING" },
            agentApplication: { status: "APPROVED" },
            referralApplication: { status: "APPROVED" },
        });

        const links = await request("/affiliate/links", { role: Role.USER });
        const created = await request("/affiliate/links", {
            role: Role.SUPER_ADMIN,
            method: "POST",
            body: { productId: "p1" },
        });

        // Another program's approval must never unlock the Affiliate program.
        expect(links.status).toBe(403);
        expect(created.status).toBe(403);
        expect(mocks.getMyLinks).not.toHaveBeenCalled();
        expect(mocks.createLink).not.toHaveBeenCalled();
    });

    it("forbids an account with no affiliate application", async () => {
        mocks.appUserFindUnique.mockResolvedValue({
            id: "app-1",
            affiliateApplication: null,
            agentApplication: null,
            referralApplication: null,
        });

        const { status } = await request("/affiliate/earnings", {
            role: Role.ADMIN,
        });

        expect(status).toBe(403);
        expect(mocks.getMyEarnings).not.toHaveBeenCalled();
    });

    // The rejected sub-resource request must be a clear, expected 403 (never a
    // 500) so the dashboard can treat it as an application-state message.
    it("answers an unapproved earnings request with a clear 403", async () => {
        mocks.appUserFindUnique.mockResolvedValue({
            id: "app-1",
            affiliateApplication: { status: "PENDING" },
            agentApplication: null,
            referralApplication: null,
        });

        const { status, body } = await request("/affiliate/earnings", {
            role: Role.USER,
        });

        expect(status).toBe(403);
        expect(body.success).toBe(false);
        expect(body.message).toContain("approved affiliate application");
        expect(mocks.getMyEarnings).not.toHaveBeenCalled();
    });

    it("rejects an anonymous link read", async () => {
        const { status } = await request("/affiliate/links");

        expect(status).toBe(401);
        expect(mocks.getMyLinks).not.toHaveBeenCalled();
    });
});
