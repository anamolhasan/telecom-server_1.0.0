import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    EarningProgram,
    EarningRuleScope,
    EarningRuleType,
    EarningStatus,
    WalletTransactionReason,
    WalletTransactionType,
} from "../../../generated/prisma/enums";
import { EarningService } from "./earning.service";

const mocks = vi.hoisted(() => ({
    appUserFindUnique: vi.fn(),
    appUserFindUniqueOrThrow: vi.fn(),
    groupBy: vi.fn(),
    ruleCreate: vi.fn(),
    ruleFindUnique: vi.fn(),
    ruleUpdate: vi.fn(),
}));

vi.mock("../../lib/prisma", () => ({
    prisma: {
        appUser: {
            findUnique: mocks.appUserFindUnique,
            findUniqueOrThrow: mocks.appUserFindUniqueOrThrow,
        },
        earningTransaction: { groupBy: mocks.groupBy },
        commissionRule: {
            create: mocks.ruleCreate,
            findUnique: mocks.ruleFindUnique,
            update: mocks.ruleUpdate,
        },
        $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})),
    },
}));

// A small in-memory stand-in for one transaction client. It models the exact
// guarantees the service relies on: the unique idempotency key, the conditional
// `updateMany` status guard, and the wallet ledger side effects.
interface IEarningRow {
    id: string;
    status: EarningStatus;
    [key: string]: unknown;
}

const makeTx = () => {
    const byId = new Map<string, IEarningRow>();
    const byKey = new Map<string, IEarningRow>();
    let counter = 0;
    let walletCounter = 0;

    const tx = {
        earningTransaction: {
            findUnique: vi.fn(async (args: { where: Record<string, string> }) => {
                if (args.where.idempotencyKey) {
                    const row = byKey.get(args.where.idempotencyKey);
                    return row ? { ...row } : null;
                }
                const row = byId.get(args.where.id);
                return row ? { ...row } : null;
            }),
            create: vi.fn(async (args: { data: Record<string, unknown> }) => {
                const row: IEarningRow = {
                    id: `e-${(counter += 1)}`,
                    ...args.data,
                } as IEarningRow;
                byId.set(row.id, row);
                byKey.set(row.idempotencyKey as string, row);
                return { ...row };
            }),
            updateMany: vi.fn(
                async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
                    const row = byId.get(args.where.id as string);
                    if (!row || row.status !== args.where.status) {
                        return { count: 0 };
                    }
                    Object.assign(row, args.data);
                    return { count: 1 };
                },
            ),
            findUniqueOrThrow: vi.fn(async (args: { where: { id: string } }) => {
                const row = byId.get(args.where.id);
                if (!row) throw new Error("earning not found");
                return { ...row };
            }),
            findMany: vi.fn(async () => [] as IEarningRow[]),
        },
        appUser: {
            findUniqueOrThrow: vi.fn(async () => ({
                id: "app-1",
                authUserId: "user-1",
                balance: 0,
                totalEarned: 0,
            })),
            update: vi.fn(async () => ({})),
            updateMany: vi.fn(async () => ({ count: 1 })),
        },
        walletTransaction: {
            findFirst: vi.fn(async () => null),
            create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
                id: `wt-${(walletCounter += 1)}`,
                ...args.data,
            })),
        },
        commissionRule: {
            findMany: vi.fn(async () => []),
        },
    };

    return { tx: tx as never, byId, byKey };
};

const agentEarning = (overrides: Record<string, unknown> = {}) => ({
    program: EarningProgram.AGENT,
    appUserId: "app-1",
    userId: "user-1",
    amountCents: 2_500,
    baseAmountCents: 10_000,
    rule: {
        scope: EarningRuleScope.OPERATOR_OFFER,
        ruleType: EarningRuleType.PERCENTAGE,
        value: 25,
        refId: "offer-1",
    },
    idempotencyKey: "AGENT_SALE:o1:s1",
    orderId: "o1",
    description: "Agent sales commission",
    ...overrides,
});

beforeEach(() => {
    vi.resetAllMocks();
    mocks.appUserFindUnique.mockResolvedValue({ id: "app-1" });
    mocks.appUserFindUniqueOrThrow.mockResolvedValue({
        balance: 0,
        totalEarned: 0,
    });
});

describe("createEarning", () => {
    it("records an earning and credits the wallet when it becomes available", async () => {
        const { tx } = makeTx();

        const earning = await EarningService.createEarning(tx, agentEarning() as never);

        expect(earning.status).toBe(EarningStatus.AVAILABLE);
        expect(
            (tx as unknown as { walletTransaction: { create: ReturnType<typeof vi.fn> } })
                .walletTransaction.create,
        ).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    userId: "user-1",
                    type: WalletTransactionType.CREDIT,
                    reason: WalletTransactionReason.COMMISSION,
                    amount: 25,
                }),
            }),
        );
    });

    it("keeps an earning pending when it is not yet available, crediting nothing", async () => {
        const { tx } = makeTx();

        const earning = await EarningService.createEarning(tx, {
            ...agentEarning(),
            availableImmediately: false,
        } as never);

        expect(earning.status).toBe(EarningStatus.PENDING);
        expect(
            (tx as unknown as { walletTransaction: { create: ReturnType<typeof vi.fn> } })
                .walletTransaction.create,
        ).not.toHaveBeenCalled();
    });

    it("is idempotent on the source event key: a repeat never credits twice", async () => {
        const { tx, byId } = makeTx();

        const first = await EarningService.createEarning(tx, agentEarning() as never);
        const second = await EarningService.createEarning(tx, agentEarning() as never);

        expect(second.id).toBe(first.id);
        // A duplicate payment event, retry or second milestone request resolves to
        // the original earning and must not touch the wallet again.
        expect(byId.size).toBe(1);
        expect(
            (tx as unknown as { walletTransaction: { create: ReturnType<typeof vi.fn> } })
                .walletTransaction.create,
        ).toHaveBeenCalledTimes(1);
    });

    it("never credits a zero-amount earning", async () => {
        const { tx } = makeTx();

        const earning = await EarningService.createEarning(tx, {
            ...agentEarning(),
            amountCents: 0,
        } as never);

        expect(earning.status).toBe(EarningStatus.PENDING);
        expect(
            (tx as unknown as { walletTransaction: { create: ReturnType<typeof vi.fn> } })
                .walletTransaction.create,
        ).not.toHaveBeenCalled();
    });

    it("stores the rule snapshot frozen at award time", async () => {
        const { tx, byId } = makeTx();

        await EarningService.createEarning(tx, agentEarning() as never);

        const [row] = [...byId.values()];
        expect(row.ruleSnapshot).toEqual({
            program: EarningProgram.AGENT,
            scope: EarningRuleScope.OPERATOR_OFFER,
            ruleType: EarningRuleType.PERCENTAGE,
            value: "25.00",
            refId: "offer-1",
            commissionRuleId: null,
        });
    });
});

describe("markEarningAvailable", () => {
    it("does not credit an already-available earning again", async () => {
        const { tx } = makeTx();

        const earning = await EarningService.createEarning(tx, agentEarning() as never);
        await EarningService.markEarningAvailable(tx, earning.id);

        expect(
            (tx as unknown as { walletTransaction: { create: ReturnType<typeof vi.fn> } })
                .walletTransaction.create,
        ).toHaveBeenCalledTimes(1);
    });

    it("fails loudly when the conditional status update loses a race", async () => {
        const { tx } = makeTx();
        const created = await EarningService.createEarning(tx, {
            ...agentEarning(),
            availableImmediately: false,
        } as never);

        (
            tx as unknown as {
                earningTransaction: { updateMany: ReturnType<typeof vi.fn> };
            }
        ).earningTransaction.updateMany.mockResolvedValue({ count: 0 });

        await expect(
            EarningService.markEarningAvailable(tx, created.id),
        ).rejects.toThrow();
    });

    it("rejects an unknown earning", async () => {
        const { tx } = makeTx();

        await expect(
            EarningService.markEarningAvailable(tx, "missing"),
        ).rejects.toThrow();
    });
});

describe("reverseEarning", () => {
    it("compensates an available earning with a debit and freezes the row", async () => {
        const { tx } = makeTx();

        const earning = await EarningService.createEarning(tx, agentEarning() as never);
        const reversed = await EarningService.reverseEarning(tx, earning.id);

        expect(reversed?.status).toBe(EarningStatus.REVERSED);
        const walletCreate = (
            tx as unknown as {
                walletTransaction: { create: ReturnType<typeof vi.fn> };
            }
        ).walletTransaction.create;

        expect(walletCreate).toHaveBeenCalledTimes(2);
        expect(walletCreate).toHaveBeenLastCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    type: WalletTransactionType.DEBIT,
                    reason: WalletTransactionReason.ADJUSTMENT,
                    amount: 25,
                }),
            }),
        );
    });

    it("is a no-op for an already-reversed earning", async () => {
        const { tx } = makeTx();

        const earning = await EarningService.createEarning(tx, agentEarning() as never);
        await EarningService.reverseEarning(tx, earning.id);
        const second = await EarningService.reverseEarning(tx, earning.id);

        expect(second).toBeNull();
        expect(
            (tx as unknown as { walletTransaction: { create: ReturnType<typeof vi.fn> } })
                .walletTransaction.create,
        ).toHaveBeenCalledTimes(2);
    });

    it("freezes a pending earning without touching the wallet", async () => {
        const { tx } = makeTx();

        const earning = await EarningService.createEarning(tx, {
            ...agentEarning(),
            availableImmediately: false,
        } as never);
        const reversed = await EarningService.reverseEarning(tx, earning.id);

        expect(reversed?.status).toBe(EarningStatus.REVERSED);
        expect(
            (tx as unknown as { walletTransaction: { create: ReturnType<typeof vi.fn> } })
                .walletTransaction.create,
        ).not.toHaveBeenCalled();
    });
});

describe("reverseEarningsForSource", () => {
    it("reverses every earning attached to a cancelled/refunded order", async () => {
        const { tx, byId } = makeTx();

        const available = await EarningService.createEarning(tx, agentEarning() as never);
        const pending = await EarningService.createEarning(tx, {
            ...agentEarning(),
            idempotencyKey: "AFFILIATE_CONVERSION:po1:a1",
            program: EarningProgram.AFFILIATE,
            orderId: null,
            productOrderId: "po1",
            availableImmediately: false,
        } as never);

        (
            tx as unknown as {
                earningTransaction: { findMany: ReturnType<typeof vi.fn> };
            }
        ).earningTransaction.findMany.mockResolvedValue([
            { ...byId.get(available.id) },
            { ...byId.get(pending.id) },
        ]);

        const reversed = await EarningService.reverseEarningsForSource(tx, {
            productOrderId: "po1",
        });

        expect(reversed).toHaveLength(2);
        expect(byId.get(available.id)?.status).toBe(EarningStatus.REVERSED);
        expect(byId.get(pending.id)?.status).toBe(EarningStatus.REVERSED);
    });
});

describe("resolveCommissionRule", () => {
    it("queries active rules for the program and the applicable scopes", async () => {
        const { tx } = makeTx();

        await EarningService.resolveCommissionRule(tx, {
            program: EarningProgram.AFFILIATE,
            productId: "p1",
            productVariantId: "v1",
        });

        expect(
            (
                tx as unknown as {
                    commissionRule: { findMany: ReturnType<typeof vi.fn> };
                }
            ).commissionRule.findMany,
        ).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    program: EarningProgram.AFFILIATE,
                    isActive: true,
                }),
            }),
        );
    });

    it("returns the most specific configured rule", async () => {
        const { tx } = makeTx();

        (
            tx as unknown as {
                commissionRule: { findMany: ReturnType<typeof vi.fn> };
            }
        ).commissionRule.findMany.mockResolvedValue([
            {
                id: "global",
                scope: EarningRuleScope.GLOBAL,
                priority: 0,
                createdAt: new Date("2026-01-01"),
            },
            {
                id: "product",
                scope: EarningRuleScope.PRODUCT,
                priority: 0,
                createdAt: new Date("2026-01-01"),
            },
        ]);

        const rule = await EarningService.resolveCommissionRule(tx, {
            program: EarningProgram.AGENT,
            productId: "p1",
        });

        expect(rule?.id).toBe("product");
    });
});

describe("commission rule administration", () => {
    it("refuses a GLOBAL rule that targets a product", async () => {
        await expect(
            EarningService.createCommissionRule(
                { userId: "admin", role: "ADMIN", email: "a@x.com" } as never,
                {
                    program: EarningProgram.AGENT,
                    scope: EarningRuleScope.GLOBAL,
                    ruleType: EarningRuleType.FIXED,
                    value: 10,
                    productId: "p1",
                },
            ),
        ).rejects.toThrow();
    });

    it("refuses a scoped rule with no target", async () => {
        await expect(
            EarningService.createCommissionRule(
                { userId: "admin", role: "ADMIN", email: "a@x.com" } as never,
                {
                    program: EarningProgram.AGENT,
                    scope: EarningRuleScope.PRODUCT,
                    ruleType: EarningRuleType.FIXED,
                    value: 10,
                },
            ),
        ).rejects.toThrow();
    });

    it("refuses a rule that targets two resources at once", async () => {
        await expect(
            EarningService.createCommissionRule(
                { userId: "admin", role: "ADMIN", email: "a@x.com" } as never,
                {
                    program: EarningProgram.AGENT,
                    scope: EarningRuleScope.PRODUCT,
                    ruleType: EarningRuleType.FIXED,
                    value: 10,
                    productId: "p1",
                    operatorOfferId: "o1",
                },
            ),
        ).rejects.toThrow();
    });

    it("persists a valid scoped rule with a fixed 2-decimal value", async () => {
        mocks.ruleCreate.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
            id: "rule-1",
            ...args.data,
            createdAt: new Date(),
            updatedAt: new Date(),
        }));

        const rule = await EarningService.createCommissionRule(
            { userId: "admin", role: "ADMIN", email: "a@x.com" } as never,
            {
                program: EarningProgram.AFFILIATE,
                scope: EarningRuleScope.PRODUCT,
                ruleType: EarningRuleType.PERCENTAGE,
                value: 5.5,
                productId: "p1",
            },
        );

        expect(mocks.ruleCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    value: "5.50",
                    productId: "p1",
                    productVariantId: null,
                    operatorOfferId: null,
                }),
            }),
        );
        expect(rule.value).toBe(5.5);
    });
});

describe("getMyEarningSummary", () => {
    it("reports pending money separately from the spendable balance", async () => {
        mocks.appUserFindUnique.mockResolvedValue({ id: "app-1" });
        mocks.appUserFindUniqueOrThrow.mockResolvedValue({
            balance: 40,
            totalEarned: 90,
        });
        mocks.groupBy.mockResolvedValue([
            { program: EarningProgram.AGENT, status: EarningStatus.PENDING, _sum: { amount: 10 } },
            { program: EarningProgram.AGENT, status: EarningStatus.AVAILABLE, _sum: { amount: 40 } },
            { program: EarningProgram.REFERRAL, status: EarningStatus.AVAILABLE, _sum: { amount: 50 } },
            { program: EarningProgram.AFFILIATE, status: EarningStatus.REVERSED, _sum: { amount: 5 } },
        ]);

        const summary = await EarningService.getMyEarningSummary({
            userId: "user-1",
            role: "USER",
            email: "u@x.com",
        } as never);

        expect(summary.pendingTotal).toBe(10);
        expect(summary.availableTotal).toBe(90);
        expect(summary.reversedTotal).toBe(5);
        expect(summary.walletBalance).toBe(40);
        expect(summary.programs.find((p) => p.program === EarningProgram.AGENT)).toEqual({
            program: EarningProgram.AGENT,
            pending: 10,
            available: 40,
            reversed: 0,
            totalEarned: 40,
        });
    });
});
