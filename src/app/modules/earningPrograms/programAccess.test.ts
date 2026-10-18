import { describe, expect, it, vi } from "vitest";
import {
    AffiliateApplicationStatus,
    AgentApplicationStatus,
    ReferralApplicationStatus,
    Role,
} from "../../../generated/prisma/enums";
import { ALL_ROLES } from "../../constants/rbac.constant";
import { AgentApplicationService } from "./agent/agentApplication/agentApplication.service";
import { AffiliateApplicationService } from "./affiliate/affiliateApplication/affiliateApplication.service";
import { ReferralApplicationService } from "./referral/referralApplication/referralApplication.service";

// Requirement: EVERY system role may independently apply for, and earn through,
// the Agent, Referral and Affiliate programs. A role is never an approval, and a
// role is never a barrier. These tests exercise the real service layer with a
// fake transaction client so the eligibility rules (not the HTTP wiring, which is
// covered elsewhere) are what is verified.

const USER = (role: Role) => ({ userId: "u-1", role, email: "u@x.com" });

const appUserRow = { id: "app-1", isDeleted: false };

interface IFakeTables {
    agent?: unknown;
    affiliate?: unknown;
    referral?: unknown;
}

// One fake transaction client shared by all three services. Each program owns a
// separate table, which is exactly what makes the three approval lifecycles
// independent.
const makeClient = (tables: IFakeTables = {}) => {
    const tx = {
        appUser: {
            findUnique: vi.fn(async () => appUserRow),
            update: vi.fn(async () => ({})),
        },
        agentApplication: {
            findUnique: vi.fn(async () => tables.agent ?? null),
            create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
                id: "agent-1",
                ...args.data,
            })),
            update: vi.fn(async (args: { data: Record<string, unknown> }) => ({
                id: "agent-1",
                ...args.data,
            })),
        },
        affiliateApplication: {
            findUnique: vi.fn(async () => tables.affiliate ?? null),
            create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
                id: "affiliate-1",
                ...args.data,
            })),
            update: vi.fn(async (args: { data: Record<string, unknown> }) => ({
                id: "affiliate-1",
                ...args.data,
            })),
        },
        referralApplication: {
            findUnique: vi.fn(async () => tables.referral ?? null),
            create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
                id: "referral-1",
                ...args.data,
            })),
            update: vi.fn(async (args: { data: Record<string, unknown> }) => ({
                id: "referral-1",
                ...args.data,
            })),
        },
    };

    const client = {
        ...tx,
        $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(tx)),
    };

    return { client: client as never, tx, $transaction: client.$transaction };
};

const referralPayload = {
    promotionMethod: "SOCIAL_MEDIA",
    reason: "I want to invite my network to the platform",
    termsAccepted: true,
};

describe("every system role can apply for every program", () => {
    it.each(ALL_ROLES)("a %s can submit an Agent application", async (role) => {
        const { client, tx } = makeClient();

        const result = await AgentApplicationService.submitAgentApplication(
            USER(role) as never,
            { reason: "I sell telecom offers" },
            client,
        );

        expect(tx.agentApplication.create).toHaveBeenCalledTimes(1);
        expect(result).toEqual(
            expect.objectContaining({ status: AgentApplicationStatus.PENDING }),
        );
    });

    it.each(ALL_ROLES)("a %s can submit an Affiliate application", async (role) => {
        const { client, tx } = makeClient();

        const result = await AffiliateApplicationService.submitAffiliateApplication(
            USER(role) as never,
            { reason: "I run a review channel" },
            client,
        );

        expect(tx.affiliateApplication.create).toHaveBeenCalledTimes(1);
        expect(result).toEqual(
            expect.objectContaining({ status: AffiliateApplicationStatus.PENDING }),
        );
    });

    it.each(ALL_ROLES)("a %s can submit a Referral application", async (role) => {
        const { client, tx } = makeClient();

        const result = await ReferralApplicationService.applyForReferralIncome(
            USER(role) as never,
            referralPayload as never,
            client,
        );

        expect(tx.referralApplication.create).toHaveBeenCalledTimes(1);
        expect(result).toEqual(
            expect.objectContaining({ status: ReferralApplicationStatus.PENDING }),
        );
    });
});

describe("one application per program per user", () => {
    it("refuses a second Agent application", async () => {
        const { client } = makeClient({ agent: { id: "agent-1" } });

        await expect(
            AgentApplicationService.submitAgentApplication(
                USER(Role.USER) as never,
                {},
                client,
            ),
        ).rejects.toThrow();
    });

    it("refuses a second Affiliate application", async () => {
        const { client } = makeClient({ affiliate: { id: "affiliate-1" } });

        await expect(
            AffiliateApplicationService.submitAffiliateApplication(
                USER(Role.ADMIN) as never,
                {},
                client,
            ),
        ).rejects.toThrow();
    });

    it("refuses a second Referral application", async () => {
        const { client } = makeClient({ referral: { id: "referral-1" } });

        await expect(
            ReferralApplicationService.applyForReferralIncome(
                USER(Role.SUPER_ADMIN) as never,
                referralPayload as never,
                client,
            ),
        ).rejects.toThrow();
    });
});

describe("program approvals are independent", () => {
    it("approving the Agent program never approves the other two", async () => {
        const { client, tx } = makeClient({
            agent: {
                id: "agent-1",
                appUserId: "app-1",
                status: AgentApplicationStatus.PENDING,
                appUser: { authUserId: "other" },
            },
        });

        await AgentApplicationService.reviewAgentApplication(
            "agent-1",
            { status: AgentApplicationStatus.APPROVED },
            USER(Role.ADMIN) as never,
            client,
        );

        // Only the agent table and its derived cache are touched.
        expect(tx.agentApplication.update).toHaveBeenCalledTimes(1);
        expect(tx.affiliateApplication.update).not.toHaveBeenCalled();
        expect(tx.referralApplication.update).not.toHaveBeenCalled();
    });

    it("derives agent status from the Agent application alone", async () => {
        const approved = await AgentApplicationService.getAgentStatus(
            makeClient({ agent: { status: AgentApplicationStatus.APPROVED } }).client,
            "app-1",
        );
        const pending = await AgentApplicationService.getAgentStatus(
            makeClient({ agent: { status: AgentApplicationStatus.PENDING } }).client,
            "app-1",
        );
        const none = await AgentApplicationService.getAgentStatus(
            makeClient().client,
            "app-1",
        );

        expect(approved).toEqual({ approved: true, eligible: true });
        expect(pending).toEqual({ approved: false, eligible: false });
        expect(none).toEqual({ approved: false, eligible: false });
    });
});

describe("only administrators may review applications", () => {
    it.each([Role.MODERATOR, Role.SUPPORTER, Role.EMPLOYEE, Role.USER])(
        "refuses a %s reviewing an agent application",
        async (role) => {
            const { client, tx } = makeClient({
                agent: {
                    id: "agent-1",
                    appUserId: "app-1",
                    status: AgentApplicationStatus.PENDING,
                    appUser: { authUserId: "other" },
                },
            });

            await expect(
                AgentApplicationService.reviewAgentApplication(
                    "agent-1",
                    { status: AgentApplicationStatus.APPROVED },
                    USER(role) as never,
                    client,
                ),
            ).rejects.toThrow();

            expect(tx.agentApplication.update).not.toHaveBeenCalled();
        },
    );

    it.each([Role.MODERATOR, Role.SUPPORTER, Role.EMPLOYEE, Role.USER])(
        "refuses a %s reviewing an affiliate application",
        async (role) => {
            const { client, tx } = makeClient({
                affiliate: {
                    id: "affiliate-1",
                    appUserId: "app-1",
                    status: AffiliateApplicationStatus.PENDING,
                    appUser: { authUserId: "other" },
                },
            });

            await expect(
                AffiliateApplicationService.reviewAffiliateApplication(
                    "affiliate-1",
                    { status: AffiliateApplicationStatus.APPROVED },
                    USER(role) as never,
                    client,
                ),
            ).rejects.toThrow();

            expect(tx.affiliateApplication.update).not.toHaveBeenCalled();
        },
    );

    it("refuses an administrator reviewing their own application", async () => {
        const { client } = makeClient({
            agent: { id: "agent-1", appUserId: "app-1", appUser: { authUserId: "u-1" } },
        });

        await expect(
            AgentApplicationService.reviewAgentApplication(
                "agent-1",
                { status: AgentApplicationStatus.APPROVED },
                USER(Role.SUPER_ADMIN) as never,
                client,
            ),
        ).rejects.toThrow();
    });

    it("requires a rejection reason when rejecting", async () => {
        const { client } = makeClient({
            referral: {
                id: "referral-1",
                appUserId: "app-1",
                status: ReferralApplicationStatus.PENDING,
                appUser: { authUserId: "other" },
            },
        });

        await expect(
            ReferralApplicationService.reviewApplication(
                "referral-1",
                { status: ReferralApplicationStatus.REJECTED },
                USER(Role.ADMIN) as never,
                client,
            ),
        ).rejects.toThrow();
    });
});
