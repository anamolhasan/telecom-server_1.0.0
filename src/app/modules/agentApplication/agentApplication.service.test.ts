import { afterEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "../../../generated/prisma/client";
import { AgentApplicationStatus, Role } from "../../../generated/prisma/enums";
import { AgentApplicationService } from "./agentApplication.service";


interface ISubmitOverrides {
    appUser?: { id: string; authUserId: string; isDeleted: boolean } | null;
    existing?: { id: string; appUserId: string; status: AgentApplicationStatus } | null;
}

const makeSubmitClient = (overrides: ISubmitOverrides = {}) => {
    const tx = {
        appUser: {
            findUnique: vi.fn().mockResolvedValue(
                overrides.appUser === undefined
                    ? { id: "app1", authUserId: "user1", isDeleted: false }
                    : overrides.appUser,
            ),
        },
        agentApplication: {
            findUnique: vi.fn().mockResolvedValue(overrides.existing ?? null),
            create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
                id: "aa-new",
                ...args.data,
            })),
        },
        $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    };

    return { client: tx as unknown as Prisma.TransactionClient, tx };
};

interface IReviewOverrides {
    application?: {
        id: string;
        appUserId: string;
        status: AgentApplicationStatus;
        appUser: { authUserId: string };
    } | null;
    ownApplication?: boolean;
}

const makeReviewClient = (overrides: IReviewOverrides = {}) => {
    const authUserId = overrides.ownApplication ? "admin1" : "user1";
    const tx = {
        agentApplication: {
            findUnique: vi.fn().mockResolvedValue(
                overrides.application === undefined
                    ? {
                          id: "aa1",
                          appUserId: "app1",
                          status: AgentApplicationStatus.PENDING,
                          appUser: { authUserId },
                      }
                    : overrides.application,
            ),
            update: vi.fn(
                async (args: { where: { id: string }; data: Record<string, unknown> }) => ({
                    id: args.where.id,
                    ...args.data,
                }),
            ),
        },
        appUser: {
            update: vi.fn().mockResolvedValue({}),
        },
        user: {
            update: vi.fn().mockResolvedValue({}),
        },
        $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    };

    return { client: tx as unknown as Prisma.TransactionClient, tx };
};

const adminUser = { userId: "admin1", role: Role.ADMIN, email: "admin@x.com" };
const superAdminUser = { userId: "sa1", role: Role.SUPER_ADMIN, email: "sa@x.com" };
const userUser = { userId: "user1", role: Role.USER, email: "user@x.com" };
const agentUser = { userId: "agent1", role: Role.AGENT, email: "agent@x.com" };

afterEach(() => {
    vi.clearAllMocks();
});

describe("submitAgentApplication", () => {
    it("allows a USER to submit an application (rule 8)", async () => {
        const { client, tx } = makeSubmitClient();

        const result = await AgentApplicationService.submitAgentApplication(
            userUser,
            { reason: "I want to sell telecom offers" },
            client,
        );

        expect(result.status).toBe(AgentApplicationStatus.PENDING);
        expect(result.reason).toBe("I want to sell telecom offers");
        expect(tx.agentApplication.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ appUserId: "app1" }),
            }),
        );
    });

    it("rejects a non-USER (e.g. AGENT) from applying", async () => {
        const { client } = makeSubmitClient();
        await expect(
            AgentApplicationService.submitAgentApplication(agentUser, {}, client),
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it("rejects a second (duplicate) application", async () => {
        const { client } = makeSubmitClient({
            existing: {
                id: "aa1",
                appUserId: "app1",
                status: AgentApplicationStatus.PENDING,
            },
        });

        await expect(
            AgentApplicationService.submitAgentApplication(userUser, {}, client),
        ).rejects.toThrow("already submitted");
    });

    it("rejects an application from a deleted app user", async () => {
        const { client } = makeSubmitClient({
            appUser: { id: "app1", authUserId: "user1", isDeleted: true },
        });

        await expect(
            AgentApplicationService.submitAgentApplication(userUser, {}, client),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it("rejects an application when no app user exists", async () => {
        const { client } = makeSubmitClient({ appUser: null });
        await expect(
            AgentApplicationService.submitAgentApplication(userUser, {}, client),
        ).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe("reviewAgentApplication", () => {
    it("ADMIN approves and promotes the account to AGENT with canEarn (rules 8-9)", async () => {
        const { client, tx } = makeReviewClient();

        const result = await AgentApplicationService.reviewAgentApplication(
            "aa1",
            { status: AgentApplicationStatus.APPROVED },
            adminUser,
            client,
        );

        expect(result.status).toBe(AgentApplicationStatus.APPROVED);
        expect(result.reviewedById).toBe("admin1");
        expect(tx.user.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: "user1" },
                data: { role: Role.AGENT },
            }),
        );
        expect(tx.appUser.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: "app1" },
                data: { canEarn: true },
            }),
        );
    });

    it("SUPER_ADMIN approves as well", async () => {
        const { client, tx } = makeReviewClient();

        const result = await AgentApplicationService.reviewAgentApplication(
            "aa1",
            { status: AgentApplicationStatus.APPROVED },
            superAdminUser,
            client,
        );

        expect(result.status).toBe(AgentApplicationStatus.APPROVED);
        expect(tx.user.update).toHaveBeenCalledTimes(1);
    });

    it("rejects reviewers who are neither ADMIN nor SUPER_ADMIN", async () => {
        const { client } = makeReviewClient();
        await expect(
            AgentApplicationService.reviewAgentApplication(
                "aa1",
                { status: AgentApplicationStatus.APPROVED },
                { userId: "mod1", role: Role.MODERATOR, email: "mod@x.com" },
                client,
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it("prevents a user from reviewing their own application", async () => {
        const { client } = makeReviewClient({ ownApplication: true });
        await expect(
            AgentApplicationService.reviewAgentApplication(
                "aa1",
                { status: AgentApplicationStatus.APPROVED },
                adminUser,
                client,
            ),
        ).rejects.toThrow("own agent application");
    });

    it("rejects repeated/unauthorized state transitions", async () => {
        const { client } = makeReviewClient({
            application: {
                id: "aa1",
                appUserId: "app1",
                status: AgentApplicationStatus.APPROVED,
                appUser: { authUserId: "user1" },
            },
        });

        await expect(
            AgentApplicationService.reviewAgentApplication(
                "aa1",
                { status: AgentApplicationStatus.REJECTED },
                adminUser,
                client,
            ),
        ).rejects.toThrow("Cannot change agent application status");
    });

    it("cannot transition an application back to PENDING", async () => {
        const { client } = makeReviewClient();
        await expect(
            AgentApplicationService.reviewAgentApplication(
                "aa1",
                { status: AgentApplicationStatus.PENDING },
                adminUser,
                client,
            ),
        ).rejects.toThrow("back to PENDING");
    });

    it("requires a rejection reason when rejecting", async () => {
        const { client } = makeReviewClient();
        await expect(
            AgentApplicationService.reviewAgentApplication(
                "aa1",
                { status: AgentApplicationStatus.REJECTED },
                adminUser,
                client,
            ),
        ).rejects.toThrow("Rejection reason is required");
    });

    it("rejects with a reason and does not change the role", async () => {
        const { client, tx } = makeReviewClient();

        const result = await AgentApplicationService.reviewAgentApplication(
            "aa1",
            { status: AgentApplicationStatus.REJECTED, rejectionReason: "Did not meet criteria" },
            adminUser,
            client,
        );

        expect(result.status).toBe(AgentApplicationStatus.REJECTED);
        expect(result.rejectionReason).toBe("Did not meet criteria");
        expect(result.reviewedById).toBe("admin1");
        expect(tx.user.update).not.toHaveBeenCalled();
        expect(tx.appUser.update).not.toHaveBeenCalled();
    });

    it("returns NOT_FOUND for an unknown application", async () => {
        const { client } = makeReviewClient({ application: null });
        await expect(
            AgentApplicationService.reviewAgentApplication(
                "missing",
                { status: AgentApplicationStatus.APPROVED },
                adminUser,
                client,
            ),
        ).rejects.toMatchObject({ statusCode: 404 });
    });
});