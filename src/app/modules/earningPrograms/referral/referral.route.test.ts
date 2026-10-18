import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import cookieParser from "cookie-parser";
import {
    EarningProgram,
    ReferralApplicationStatus,
    Role,
    UserStatus,
} from "../../../../generated/prisma/enums";
import { envVars } from "../../../config/env";
import { globalErrorHandler } from "../../../middleware/globalErrorHandler";
import { jwtUtils } from "../../../utils/jwt";
import { IndexRouters } from "../../../routes";

// The real route -> middleware -> controller pipeline is exercised against a
// mocked session lookup and a mocked service boundary, so what is under test is
// the HTTP authorization contract of the Referral programme:
//
//   * programme participation (own dashboard, own milestone, public default code)
//     is reachable regardless of the account's system role and before approval;
//   * reward-bearing views (earnings) still require the persisted APPROVED
//     referral application;
//   * authentication is never skipped.
const mocks = vi.hoisted(() => ({
    sessionFindFirst: vi.fn(),
    appUserFindUnique: vi.fn(),
    getPartnerReferralDashboard: vi.fn(),
    getMyMilestone: vi.fn(),
    getDefaultReferralCode: vi.fn(),
    getMyEarnings: vi.fn(),
}));

vi.mock("../../../lib/prisma", () => ({
    prisma: {
        session: { findFirst: mocks.sessionFindFirst },
        appUser: { findUnique: mocks.appUserFindUnique },
    },
}));

vi.mock("./referral.service", () => ({
    ReferralService: {
        getPartnerReferralDashboard: mocks.getPartnerReferralDashboard,
        getMyMilestone: mocks.getMyMilestone,
        getDefaultReferralCode: mocks.getDefaultReferralCode,
    },
}));

vi.mock("./referralApplication/referralApplication.service", () => ({
    ReferralApplicationService: {
        applyForReferralIncome: vi.fn(),
        getMyReferral: vi.fn(),
        getAllApplications: vi.fn(),
        reviewApplication: vi.fn(),
    },
}));

vi.mock("../../earning/earning.service", () => ({
    EarningService: {
        getMyEarnings: mocks.getMyEarnings,
    },
}));

const ALL_ROLES = [
    Role.SUPER_ADMIN,
    Role.ADMIN,
    Role.MODERATOR,
    Role.SUPPORTER,
    Role.EMPLOYEE,
    Role.USER,
];

const emptyPage = () => ({
    data: [],
    meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
});

const dashboardView = (applicationStatus: ReferralApplicationStatus | null) => ({
    referralCode: "CODE1234",
    applicationStatus,
    totalReferredCount: 0,
    activeReferredCount: 0,
    targetActiveReferrals: 3,
    referralIncomeEligible: false,
    referrals: [],
});

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
    options: { role?: Role } = {},
): Promise<{ status: number; body: ApiBody }> => {
    const headers: Record<string, string> = {};

    if (options.role) {
        mocks.sessionFindFirst.mockResolvedValue(buildSession(options.role));
        headers.Cookie = buildCookieHeader(options.role);
    }

    const response = await fetch(`${baseUrl}${path}`, { method, headers });

    return {
        status: response.status,
        body: (await response.json()) as ApiBody,
    };
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
    // Default: an authenticated account that has never submitted an application.
    mocks.appUserFindUnique.mockResolvedValue({
        id: "app-1",
        agentApplication: null,
        affiliateApplication: null,
        referralApplication: null,
    });
    mocks.getPartnerReferralDashboard.mockResolvedValue(dashboardView(null));
    mocks.getMyMilestone.mockResolvedValue({
        requiredReferralCount: 3,
        activeReferralCount: 0,
        qualified: false,
        awarded: false,
        awardedAt: null,
        amount: 0,
        currency: "bdt",
        configured: false,
        settingKey: "REFERRAL_MILESTONE_REWARD_AMOUNT",
    });
    mocks.getDefaultReferralCode.mockResolvedValue({ referralCode: "GLOBAL1" });
    mocks.getMyEarnings.mockResolvedValue(emptyPage());
});

const setApplicationStatus = (status: ReferralApplicationStatus | null) => {
    mocks.appUserFindUnique.mockResolvedValue({
        id: "app-1",
        agentApplication: null,
        affiliateApplication: null,
        referralApplication: status === null ? null : { status },
    });
};

describe("programme participation: GET /referral/partner", () => {
    it("still requires authentication", async () => {
        const { status } = await request("GET", "/referral/partner");

        expect(status).toBe(401);
        expect(mocks.getPartnerReferralDashboard).not.toHaveBeenCalled();
    });

    it.each(ALL_ROLES)(
        "serves the caller's own dashboard to a %s account before any approval",
        async (role) => {
            const { status, body } = await request("GET", "/referral/partner", {
                role,
            });

            expect(status).toBe(200);
            expect(body.success).toBe(true);

            // The dashboard is scoped to the session user; no role gate is applied.
            expect(mocks.getPartnerReferralDashboard).toHaveBeenCalledWith(
                expect.objectContaining({ userId: "u-1", role }),
            );
        },
    );

    it("does not consult the application status to serve the dashboard", async () => {
        // An unapproved (PENDING) applicant must be able to see their own referral
        // code, their own referred accounts and where their application stands.
        setApplicationStatus(ReferralApplicationStatus.PENDING);

        const { status } = await request("GET", "/referral/partner", {
            role: Role.USER,
        });

        expect(status).toBe(200);
        expect(mocks.getPartnerReferralDashboard).toHaveBeenCalledTimes(1);
    });
});

describe("reward eligibility: GET /referral/earnings", () => {
    it("still requires authentication", async () => {
        const { status } = await request("GET", "/referral/earnings");

        expect(status).toBe(401);
        expect(mocks.getMyEarnings).not.toHaveBeenCalled();
    });

    it("rejects an account that never applied", async () => {
        const { status } = await request("GET", "/referral/earnings", {
            role: Role.USER,
        });

        expect(status).toBe(403);
        expect(mocks.getMyEarnings).not.toHaveBeenCalled();
    });

    it.each([
        ReferralApplicationStatus.PENDING,
        ReferralApplicationStatus.REJECTED,
    ])("rejects a %s application", async (applicationStatus) => {
        setApplicationStatus(applicationStatus);

        const { status } = await request("GET", "/referral/earnings", {
            role: Role.USER,
        });

        expect(status).toBe(403);
        expect(mocks.getMyEarnings).not.toHaveBeenCalled();
    });

    it("serves the caller's own referral earnings once approved", async () => {
        setApplicationStatus(ReferralApplicationStatus.APPROVED);

        const { status, body } = await request("GET", "/referral/earnings", {
            role: Role.USER,
        });

        expect(status).toBe(200);
        expect(body.success).toBe(true);

        // The program is forced server-side; a client filter can never widen it.
        expect(mocks.getMyEarnings).toHaveBeenCalledWith(
            expect.objectContaining({ userId: "u-1" }),
            expect.anything(),
            { program: EarningProgram.REFERRAL },
        );
    });
});

describe("public page access: GET /referral/default-code", () => {
    it("is reachable without a session", async () => {
        const { status, body } = await request("GET", "/referral/default-code");

        expect(status).toBe(200);
        expect(body.success).toBe(true);
        expect(mocks.getDefaultReferralCode).toHaveBeenCalledTimes(1);
    });
});

describe("own milestone progress: GET /referral/milestone", () => {
    it("requires authentication", async () => {
        const { status } = await request("GET", "/referral/milestone");

        expect(status).toBe(401);
        expect(mocks.getMyMilestone).not.toHaveBeenCalled();
    });

    it("is readable before approval because it only reports the caller's own progress", async () => {
        setApplicationStatus(null);

        const { status } = await request("GET", "/referral/milestone", {
            role: Role.USER,
        });

        expect(status).toBe(200);
        expect(mocks.getMyMilestone).toHaveBeenCalledWith(
            expect.objectContaining({ userId: "u-1" }),
        );
    });
});
