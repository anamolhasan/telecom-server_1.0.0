import status from "http-status";
import { Prisma } from "../../../generated/prisma/client";
import {
    EarningProgram,
    EarningRuleScope,
    EarningStatus,
    WalletTransactionReason,
    WalletTransactionType,
} from "../../../generated/prisma/enums";
import AppError from "../../errorHelpers/AppError";
import type {
    IQueryParams,
    PrismaModelDelegate,
} from "../../interfaces/query.interface";
import type { IRequestUser } from "../../interfaces/requestUser.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { centsToMoney, toMoneyCents, toMoneyNumber } from "../ecommerce/ecommerce.utils";
import { applyWalletTransaction } from "../wallet/wallet.utils";
import {
    buildRuleSnapshot,
    pickMostSpecificRule,
    walletReasonForProgram,
} from "./earning.rule";
import type {
    IAwardEarningPayload,
    ICommissionRulePayload,
    IEarningSummary,
    IUpdateCommissionRulePayload,
} from "./earning.interface";
import {
    toCommissionRuleView,
    toCommissionRuleViews,
    toPublicEarnings,
} from "./earning.public";

type EarningClient = Prisma.TransactionClient | typeof prisma;

// Every amount is written as a fixed 2-decimal string, so no binary floating
// point rounding can reach a Decimal(12, 2) column.
const toDecimalString = (cents: number): string => (cents / 100).toFixed(2);

const centAmount = (value: unknown): number => toMoneyCents(value);

const roundCents = (value: unknown): number => Math.max(0, Math.round(Number(value) || 0));

// ─────────────────────────────────────────────────────────────────────────────
// Rule resolution
// ─────────────────────────────────────────────────────────────────────────────
// Most specific active rule wins (variant > product > operator offer > global),
// then priority, then newest. Pure precedence lives in earning.rule.
const resolveCommissionRule = async (
    client: EarningClient,
    input: {
        program: EarningProgram;
        productId?: string | null;
        productVariantId?: string | null;
        operatorOfferId?: string | null;
    },
) => {
    const or: Prisma.CommissionRuleWhereInput[] = [
        { scope: EarningRuleScope.GLOBAL },
    ];

    if (input.productVariantId) {
        or.push({
            scope: EarningRuleScope.PRODUCT_VARIANT,
            productVariantId: input.productVariantId,
        });
    }
    if (input.productId) {
        or.push({ scope: EarningRuleScope.PRODUCT, productId: input.productId });
    }
    if (input.operatorOfferId) {
        or.push({
            scope: EarningRuleScope.OPERATOR_OFFER,
            operatorOfferId: input.operatorOfferId,
        });
    }

    const rules = await client.commissionRule.findMany({
        where: { program: input.program, isActive: true, OR: or },
    });

    return pickMostSpecificRule(rules);
};

// ─────────────────────────────────────────────────────────────────────────────
// Ledger writes
// ─────────────────────────────────────────────────────────────────────────────
// Record one immutable earning. Idempotent on `idempotencyKey`: a repeat of the
// same source event (a duplicate webhook, a retried transaction, a second
// milestone request) resolves to the row that already exists instead of
// crediting twice. Creating an earning and realising it are the same transaction
// when `availableImmediately` is true, so the ledger and the wallet can never
// disagree.
// Build the persistent row for one earning event. Centralised so a PENDING
// accrual and an already-realised earning (whose wallet movement was made by
// another module) can never disagree about shape or precision.
const buildEarningData = (
    payload: IAwardEarningPayload,
    state: {
        status: EarningStatus;
        availableAt?: Date | null;
        walletTransactionId?: string | null;
    },
) => {
    const amountCents = roundCents(payload.amountCents);
    const baseAmountCents = roundCents(payload.baseAmountCents);
    const rule = payload.rule;

    return {
        program: payload.program,
        status: state.status,
        appUserId: payload.appUserId,
        userId: payload.userId,
        amount: toDecimalString(amountCents),
        currency: payload.currency ?? "bdt",
        walletReason: payload.walletReason ?? walletReasonForProgram(payload.program),
        ruleType: rule.ruleType,
        ruleValue: toDecimalString(centAmount(rule.value)),
        ruleScope: rule.scope,
        ruleRefId: rule.refId ?? null,
        ruleSnapshot: buildRuleSnapshot({
            program: payload.program,
            scope: rule.scope,
            ruleType: rule.ruleType,
            value: rule.value,
            refId: rule.refId ?? null,
            commissionRuleId: rule.commissionRuleId ?? null,
        }) as unknown as Prisma.InputJsonValue,
        commissionRuleId: rule.commissionRuleId ?? null,
        baseAmount: toDecimalString(baseAmountCents),
        orderId: payload.orderId ?? null,
        productOrderId: payload.productOrderId ?? null,
        idempotencyKey: payload.idempotencyKey,
        description: payload.description ?? null,
        availableAt: state.availableAt ?? null,
        walletTransactionId: state.walletTransactionId ?? null,
    };
};

const createEarning = async (
    tx: Prisma.TransactionClient,
    payload: IAwardEarningPayload,
) => {
    const existing = await tx.earningTransaction.findUnique({
        where: { idempotencyKey: payload.idempotencyKey },
    });

    if (existing) {
        return existing;
    }

    const amountCents = roundCents(payload.amountCents);

    const earning = await tx.earningTransaction.create({
        data: buildEarningData(payload, { status: EarningStatus.PENDING }),
    });

    if (amountCents <= 0 || payload.availableImmediately === false) {
        return earning;
    }

    return (await markEarningAvailable(tx, earning.id)) ?? earning;
};

// Record an earning whose money was already moved by another module (for example
// the legacy per-order referral income credit). The row is written straight to
// AVAILABLE and linked to the existing wallet transaction, so the ledger keeps the
// rule snapshot and the program history without moving the balance a second time.
const recordRealisedEarning = async (
    tx: Prisma.TransactionClient,
    payload: IAwardEarningPayload & { walletTransactionId?: string | null },
) => {
    const existing = await tx.earningTransaction.findUnique({
        where: { idempotencyKey: payload.idempotencyKey },
    });

    if (existing) {
        return existing;
    }

    return tx.earningTransaction.create({
        data: buildEarningData(payload, {
            status: EarningStatus.AVAILABLE,
            availableAt: new Date(),
            walletTransactionId: payload.walletTransactionId ?? null,
        }),
    });
};

// Move a PENDING earning into the wallet balance. The status check and the write
// are separated by a conditional `updateMany`, so two concurrent realisations
// cannot both credit the wallet: the loser finds `count === 0` and the whole
// transaction (including its wallet credit) rolls back.
const markEarningAvailable = async (
    tx: Prisma.TransactionClient,
    earningId: string,
) => {
    const earning = await tx.earningTransaction.findUnique({
        where: { id: earningId },
    });

    if (!earning) {
        throw new AppError(status.NOT_FOUND, "Earning not found");
    }

    if (earning.status === EarningStatus.AVAILABLE) {
        return earning;
    }

    if (earning.status !== EarningStatus.PENDING) {
        throw new AppError(
            status.CONFLICT,
            "Only a pending earning can be made available",
        );
    }

    const amountCents = roundCents(toMoneyNumber(earning.amount) * 100);

    if (amountCents <= 0) {
        return earning;
    }

    const walletTransaction = await applyWalletTransaction(tx, {
        userId: earning.userId,
        amount: centsToMoney(amountCents),
        type: WalletTransactionType.CREDIT,
        reason: earning.walletReason,
        description: earning.description ?? `Earning credit (${earning.program})`,
        orderId: earning.orderId ?? undefined,
    });

    const updated = await tx.earningTransaction.updateMany({
        where: { id: earningId, status: EarningStatus.PENDING },
        data: {
            status: EarningStatus.AVAILABLE,
            availableAt: new Date(),
            walletTransactionId: walletTransaction.id,
        },
    });

    if (updated.count === 0) {
        throw new AppError(
            status.CONFLICT,
            "Earning was realised concurrently. Please retry.",
        );
    }

    return tx.earningTransaction.findUniqueOrThrow({ where: { id: earningId } });
};

// Reverse an earning (cancellation, refund or failed fulfilment). An AVAILABLE
// earning is compensated with a DEBIT entry; a PENDING one is simply frozen. The
// row is never deleted or edited, so the financial history stays intact.
const reverseEarning = async (
    tx: Prisma.TransactionClient,
    earningId: string,
    description?: string,
) => {
    const earning = await tx.earningTransaction.findUnique({
        where: { id: earningId },
    });

    if (!earning || earning.status === EarningStatus.REVERSED) {
        return null;
    }

    if (earning.status === EarningStatus.AVAILABLE) {
        const amountCents = roundCents(toMoneyNumber(earning.amount) * 100);

        if (amountCents > 0) {
            await applyWalletTransaction(tx, {
                userId: earning.userId,
                amount: centsToMoney(amountCents),
                type: WalletTransactionType.DEBIT,
                reason: WalletTransactionReason.ADJUSTMENT,
                description:
                    description ?? `Reversal of ${earning.program} earning`,
                orderId: earning.orderId ?? undefined,
            });
        }
    }

    const updated = await tx.earningTransaction.updateMany({
        where: { id: earningId, status: earning.status },
        data: { status: EarningStatus.REVERSED, reversedAt: new Date() },
    });

    if (updated.count === 0) {
        throw new AppError(
            status.CONFLICT,
            "Earning was reversed concurrently. Please retry.",
        );
    }

    return tx.earningTransaction.findUniqueOrThrow({ where: { id: earningId } });
};

// Freeze an earning without moving money. Used when the wallet side was already
// compensated elsewhere (for example the legacy order-commission reversal), so
// the ledger row and the wallet cannot both be adjusted twice.
const markEarningReversed = async (
    tx: Prisma.TransactionClient,
    earningId: string,
) => {
    const earning = await tx.earningTransaction.findUnique({
        where: { id: earningId },
    });

    if (!earning || earning.status === EarningStatus.REVERSED) {
        return null;
    }

    const updated = await tx.earningTransaction.updateMany({
        where: { id: earningId, status: earning.status },
        data: { status: EarningStatus.REVERSED, reversedAt: new Date() },
    });

    if (updated.count === 0) {
        throw new AppError(
            status.CONFLICT,
            "Earning was reversed concurrently. Please retry.",
        );
    }

    return tx.earningTransaction.findUniqueOrThrow({ where: { id: earningId } });
};

// Reverse every earning (pending or realised) attached to a source order. Used by
// the refund/cancellation paths so no program can leave a stale credit behind.
const reverseEarningsForSource = async (
    tx: Prisma.TransactionClient,
    source: { orderId?: string; productOrderId?: string },
) => {
    if (!source.orderId && !source.productOrderId) {
        return [];
    }

    const earnings = await tx.earningTransaction.findMany({
        where: {
            status: { not: EarningStatus.REVERSED },
            ...(source.orderId ? { orderId: source.orderId } : {}),
            ...(source.productOrderId
                ? { productOrderId: source.productOrderId }
                : {}),
        },
    });

    const reversed = [];

    for (const earning of earnings) {
        const result = await reverseEarning(
            tx,
            earning.id,
            `Reversal of ${earning.program} earning for cancelled/refunded order`,
        );
        if (result) {
            reversed.push(result);
        }
    }

    return reversed;
};

// Freeze the ledger rows for a source order without touching the wallet, so a
// caller that already appended its own compensating wallet entries (see
// CommissionService.revokeOrderCommissions) does not double-adjust the balance.
const markEarningsReversedForSource = async (
    tx: Prisma.TransactionClient,
    source: { orderId?: string; productOrderId?: string },
) => {
    if (!source.orderId && !source.productOrderId) {
        return [];
    }

    const earnings = await tx.earningTransaction.findMany({
        where: {
            status: { not: EarningStatus.REVERSED },
            ...(source.orderId ? { orderId: source.orderId } : {}),
            ...(source.productOrderId
                ? { productOrderId: source.productOrderId }
                : {}),
        },
    });

    const frozen = [];

    for (const earning of earnings) {
        const result = await markEarningReversed(tx, earning.id);
        if (result) {
            frozen.push(result);
        }
    }

    return frozen;
};

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────
const getAppUserIdForRequest = async (user: IRequestUser): Promise<string> => {
    const appUser = await prisma.appUser.findUnique({
        where: { authUserId: user.userId },
        select: { id: true },
    });

    if (!appUser) {
        throw new AppError(status.NOT_FOUND, "App user not found");
    }

    return appUser.id;
};

const getMyEarnings = async (
    user: IRequestUser,
    query: IQueryParams,
    options: { program?: EarningProgram } = {},
) => {
    const appUserId = await getAppUserIdForRequest(user);

    const result = await new QueryBuilder(
        prisma.earningTransaction as unknown as PrismaModelDelegate,
        query,
        {
            searchableFields: ["description"],
            filterableFields: ["program", "status"],
        },
    )
        .search()
        .filter()
        // Ownership (and, for a program-scoped view, the program) is forced after
        // the client filters, so a query string can never widen the projection to
        // another user's earnings or to another program's ledger.
        .where({ appUserId, ...(options.program ? { program: options.program } : {}) })
        .sort()
        .paginate()
        .fields()
        .execute();

    return {
        ...result,
        data: toPublicEarnings(result.data as never[]),
    };
};

// Collapse a `groupBy(status)` result into pending / available / reversed totals.
// Shared by the general earning summary and every program dashboard so pending
// money is always reported the same way — and never as spendable balance.
export const summariseEarningGroups = (
    rows: { status: EarningStatus; _sum: { amount: unknown } }[],
): { pending: number; available: number; reversed: number } => {
    const totals = { pending: 0, available: 0, reversed: 0 };

    for (const row of rows) {
        const amount = toMoneyNumber(row._sum.amount);

        if (row.status === EarningStatus.PENDING) {
            totals.pending += amount;
        } else if (row.status === EarningStatus.AVAILABLE) {
            totals.available += amount;
        } else {
            totals.reversed += amount;
        }
    }

    return totals;
};

// Aggregate the caller's earnings per program and status. PENDING money is
// reported separately and is never part of the spendable wallet balance.
const getMyEarningSummary = async (
    user: IRequestUser,
): Promise<IEarningSummary> => {
    const appUserId = await getAppUserIdForRequest(user);

    const [grouped, appUser] = await Promise.all([
        prisma.earningTransaction.groupBy({
            by: ["program", "status"],
            where: { appUserId },
            _sum: { amount: true },
        }),
        prisma.appUser.findUniqueOrThrow({
            where: { id: appUserId },
            select: { balance: true, totalEarned: true },
        }),
    ]);

    const programs: IEarningSummary["programs"] = (
        Object.values(EarningProgram) as EarningProgram[]
    ).map((program) => ({
        program,
        pending: 0,
        available: 0,
        reversed: 0,
        totalEarned: 0,
    }));

    for (const program of programs) {
        const totals = summariseEarningGroups(
            grouped.filter((row) => row.program === program.program),
        );

        program.pending = totals.pending;
        program.available = totals.available;
        program.reversed = totals.reversed;
        // An earning only ever counts toward what was earned once it is AVAILABLE.
        program.totalEarned = totals.available;
    }
    const sum = (key: "pending" | "available" | "reversed" | "totalEarned") =>
        programs.reduce((total, item) => total + item[key], 0);

    return {
        programs,
        pendingTotal: sum("pending"),
        availableTotal: sum("available"),
        reversedTotal: sum("reversed"),
        walletBalance: toMoneyNumber(appUser.balance),
        totalEarned: toMoneyNumber(appUser.totalEarned),
    };
};

// ─────────────────────────────────────────────────────────────────────────────
// Commission rule administration
// ─────────────────────────────────────────────────────────────────────────────
const TARGET_FIELD_BY_SCOPE: Record<
    EarningRuleScope,
    "productId" | "productVariantId" | "operatorOfferId" | null
> = {
    [EarningRuleScope.PRODUCT]: "productId",
    [EarningRuleScope.PRODUCT_VARIANT]: "productVariantId",
    [EarningRuleScope.OPERATOR_OFFER]: "operatorOfferId",
    [EarningRuleScope.GLOBAL]: null,
};

const assertScopeTarget = (payload: {
    scope: EarningRuleScope;
    productId?: string | null;
    productVariantId?: string | null;
    operatorOfferId?: string | null;
}) => {
    const requiredField = TARGET_FIELD_BY_SCOPE[payload.scope];
    const provided = {
        productId: payload.productId ?? null,
        productVariantId: payload.productVariantId ?? null,
        operatorOfferId: payload.operatorOfferId ?? null,
    };

    if (!requiredField) {
        if (provided.productId || provided.productVariantId || provided.operatorOfferId) {
            throw new AppError(
                status.BAD_REQUEST,
                "A GLOBAL rule must not target a product, variant or offer",
            );
        }
        return provided;
    }

    if (!provided[requiredField]) {
        throw new AppError(
            status.BAD_REQUEST,
            `A ${payload.scope} rule requires ${requiredField}`,
        );
    }

    // Exactly one target is allowed so a rule's scope and target cannot disagree.
    const others = Object.entries(provided).filter(
        ([key, value]) => key !== requiredField && value,
    );
    if (others.length > 0) {
        throw new AppError(
            status.BAD_REQUEST,
            "A commission rule may target exactly one product, variant or offer",
        );
    }

    return provided;
};

const createCommissionRule = async (
    adminUser: IRequestUser,
    payload: ICommissionRulePayload,
) => {
    const targets = assertScopeTarget(payload);

    const rule = await prisma.commissionRule.create({
        data: {
            program: payload.program,
            scope: payload.scope,
            ruleType: payload.ruleType,
            value: toDecimalString(centAmount(payload.value)),
            productId: targets.productId,
            productVariantId: targets.productVariantId,
            operatorOfferId: targets.operatorOfferId,
            isActive: payload.isActive ?? true,
            priority: payload.priority ?? 0,
            note: payload.note ?? null,
            createdById: adminUser.userId,
        },
    });

    return toCommissionRuleView(rule);
};

const listCommissionRules = async (query: IQueryParams) => {
    const queryBuilder = new QueryBuilder(
        prisma.commissionRule as unknown as PrismaModelDelegate,
        query,
        {
            searchableFields: ["note"],
            filterableFields: [
                "program",
                "scope",
                "ruleType",
                "isActive",
                "productId",
                "productVariantId",
                "operatorOfferId",
            ],
        },
    );

    const result = await queryBuilder
        .search()
        .filter()
        .sort()
        .paginate()
        .fields()
        .execute();

    return {
        ...result,
        data: toCommissionRuleViews(result.data as never[]),
    };
};

const updateCommissionRule = async (
    ruleId: string,
    payload: IUpdateCommissionRulePayload,
) => {
    const existing = await prisma.commissionRule.findUnique({
        where: { id: ruleId },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Commission rule not found");
    }

    const rule = await prisma.commissionRule.update({
        where: { id: ruleId },
        data: {
            ...(payload.ruleType ? { ruleType: payload.ruleType } : {}),
            ...(payload.value !== undefined
                ? { value: toDecimalString(centAmount(payload.value)) }
                : {}),
            ...(payload.isActive !== undefined ? { isActive: payload.isActive } : {}),
            ...(payload.priority !== undefined ? { priority: payload.priority } : {}),
            ...(payload.note !== undefined ? { note: payload.note } : {}),
        },
    });

    return toCommissionRuleView(rule);
};

export const EarningService = {
    resolveCommissionRule,
    createEarning,
    recordRealisedEarning,
    markEarningAvailable,
    markEarningReversed,
    reverseEarning,
    reverseEarningsForSource,
    markEarningsReversedForSource,
    getMyEarnings,
    getMyEarningSummary,
    createCommissionRule,
    listCommissionRules,
    updateCommissionRule,
};
