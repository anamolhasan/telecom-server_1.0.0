import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "../../../../../generated/prisma/client";
import {
    EarningProgram,
    EarningRuleScope,
    EarningRuleType,
    EarningStatus,
    ProductOrderStatus,
    ProductPaymentStatus,
    WalletTransactionReason,
    WalletTransactionType,
} from "../../../../../generated/prisma/enums";
import { AffiliateConversionService } from "./affiliate.conversion";

// Requirements covered here:
//   • attribution is PRODUCT-specific: an order mixing products attributed to two
//     different affiliates is credited to each affiliate for its own product;
//   • a duplicate settlement never creates a second conversion or credit;
//   • an unconfigured affiliate rate never invents a commission;
//   • only a DELIVERED + PAID order pays.

interface IOverrides {
    orderStatus?: ProductOrderStatus;
    paymentStatus?: ProductPaymentStatus;
    items?: { productId: string | null; lineTotal: unknown }[];
    attributions?: Record<string, { id: string; affiliateAppUserId: string }>;
    rules?: {
        id: string;
        scope: EarningRuleScope;
        ruleType: EarningRuleType;
        value: unknown;
        priority: number;
        createdAt: Date;
        productId?: string | null;
        productVariantId?: string | null;
        operatorOfferId?: string | null;
    }[];
}

const makeTx = (overrides: IOverrides = {}) => {
    const earnings = new Map<string, Record<string, unknown>>();
    const earningsByKey = new Map<string, Record<string, unknown>>();
    const conversions = new Map<string, Record<string, unknown>>();
    let counter = 0;

    const tx = {
        productOrder: {
            findUnique: vi.fn().mockResolvedValue({
                id: "po1",
                userId: "customer-user",
                status: overrides.orderStatus ?? ProductOrderStatus.DELIVERED,
                paymentStatus: overrides.paymentStatus ?? ProductPaymentStatus.PAID,
            }),
        },
        productOrderItem: {
            findMany: vi.fn().mockResolvedValue(
                overrides.items ?? [
                    { productId: "p1", lineTotal: "100.00" },
                    { productId: "p2", lineTotal: "50.00" },
                ],
            ),
        },
        affiliateAttribution: {
            findUnique: vi.fn(
                async (args: {
                    where: {
                        uniq_affiliate_attribution_customer_product: {
                            productId: string;
                        };
                    };
                }) =>
                    overrides.attributions?.[
                        args.where.uniq_affiliate_attribution_customer_product.productId
                    ] ?? null,
            ),
        },
        affiliateConversion: {
            findUnique: vi.fn(
                async (args: {
                    where: {
                        uniq_affiliate_conversion_order_product: {
                            productId: string;
                        };
                    };
                }) =>
                    conversions.get(
                        args.where.uniq_affiliate_conversion_order_product.productId,
                    ) ?? null,
            ),
            create: vi.fn(async (args: { data: Record<string, unknown> }) => {
                const row: Record<string, unknown> = { ...args.data };
                row.id = `c-${(counter += 1)}`;
                conversions.set(row.productId as string, row);
                return row;
            }),
            update: vi.fn(
                async (args: {
                    where?: { id?: string };
                    data: Record<string, unknown>;
                }) => {
                    for (const row of conversions.values()) {
                        if (row.id === args.where?.id) Object.assign(row, args.data);
                    }
                    return args.data;
                },
            ),
        },
        commissionRule: {
            // Honours the product scope the resolver asks for, so a rule bound to
            // one product never prices another product in the same order.
            findMany: vi.fn(
                async (args: {
                    where: { OR?: { scope: EarningRuleScope; productId?: string }[] };
                }) => {
                    const requestedProducts = new Set(
                        (args.where.OR ?? [])
                            .map((clause) => clause.productId)
                            .filter((value): value is string => Boolean(value)),
                    );

                    return (overrides.rules ?? []).filter(
                        (rule) =>
                            rule.scope === EarningRuleScope.GLOBAL ||
                            (rule.productId
                                ? requestedProducts.has(rule.productId)
                                : false),
                    );
                },
            ),
        },
        appUser: {
            findUniqueOrThrow: vi.fn().mockResolvedValue({
                id: "aff-app",
                authUserId: "affiliate-auth",
                balance: 0,
                totalEarned: 0,
            }),
            update: vi.fn().mockResolvedValue({}),
        },
        earningTransaction: {
            findUnique: vi.fn(async (args: { where: Record<string, string> }) => {
                if (args.where.idempotencyKey) {
                    return earningsByKey.get(args.where.idempotencyKey) ?? null;
                }
                return earnings.get(args.where.id) ?? null;
            }),
            create: vi.fn(async (args: { data: Record<string, unknown> }) => {
                const row: Record<string, unknown> = { ...args.data };
                row.id = `e-${(counter += 1)}`;
                earnings.set(row.id as string, row);
                earningsByKey.set(row.idempotencyKey as string, row);
                return row;
            }),
            updateMany: vi.fn(
                async (args: {
                    where: { id: string; status: EarningStatus };
                    data: Record<string, unknown>;
                }) => {
                    const row = earnings.get(args.where.id);
                    if (!row || row.status !== args.where.status) {
                        return { count: 0 };
                    }
                    Object.assign(row, args.data);
                    return { count: 1 };
                },
            ),
            findUniqueOrThrow: vi.fn(async (args: { where: { id: string } }) =>
                earnings.get(args.where.id),
            ),
        },
        walletTransaction: {
            create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
                id: "wt-1",
                ...args.data,
            })),
        },
    };

    return tx as unknown as Prisma.TransactionClient & typeof tx;
};

const productRule = (ruleType: EarningRuleType, value: string) => ({
    id: "rule-1",
    scope: EarningRuleScope.PRODUCT,
    ruleType,
    value,
    priority: 1,
    createdAt: new Date("2026-10-01"),
    productId: "p1",
    productVariantId: null,
    operatorOfferId: null,
});

beforeEach(() => {
    vi.clearAllMocks();
});

describe("recordConversionsForProductOrder", () => {
    it("credits each product to its own permanent attribution", async () => {
        const tx = makeTx({
            attributions: {
                p1: { id: "at-1", affiliateAppUserId: "aff-1" },
                p2: { id: "at-2", affiliateAppUserId: "aff-2" },
            },
            items: [
                { productId: "p1", lineTotal: "100.00" },
                { productId: "p2", lineTotal: "50.00" },
            ],
            rules: [{ ...productRule(EarningRuleType.PERCENTAGE, "10"), productId: "p1" }],
        });
        // p2's affiliate resolves to a different app user.
        tx.appUser.findUniqueOrThrow.mockImplementation(
            async (args: { where: { id: string } }) => ({
                id: args.where.id,
                authUserId: `${args.where.id}-auth`,
                balance: 0,
                totalEarned: 0,
            }),
        );

        const recorded = await AffiliateConversionService.recordConversionsForProductOrder(
            tx,
            "po1",
        );

        // Two products, two affiliates: neither is collapsed onto the other.
        expect(recorded).toHaveLength(2);
        expect(tx.affiliateConversion.create).toHaveBeenCalledTimes(2);
        expect(recorded.map((row) => row.affiliateAppUserId).sort()).toEqual([
            "aff-1",
            "aff-2",
        ]);
        // Only p1 has a configured rate (10% of 100.00 = 10.00); p2 has none.
        expect(recorded.find((row) => row.productId === "p1")?.amount).toBe(10);
        expect(recorded.find((row) => row.productId === "p2")?.amount).toBe(0);
        expect(tx.walletTransaction.create).toHaveBeenCalledTimes(1);
    });

    it("never creates a second conversion or credit for a repeated settlement", async () => {
        const tx = makeTx({
            attributions: { p1: { id: "at-1", affiliateAppUserId: "aff-1" } },
            items: [{ productId: "p1", lineTotal: "100.00" }],
            rules: [productRule(EarningRuleType.PERCENTAGE, "10")],
        });

        await AffiliateConversionService.recordConversionsForProductOrder(tx, "po1");
        const second =
            await AffiliateConversionService.recordConversionsForProductOrder(tx, "po1");

        expect(tx.affiliateConversion.create).toHaveBeenCalledTimes(1);
        expect(tx.walletTransaction.create).toHaveBeenCalledTimes(1);
        expect(tx.earningTransaction.create).toHaveBeenCalledTimes(1);
        expect(second).toHaveLength(1);
        expect(second[0].credited).toBe(true);
    });

    it("never invents a commission when no affiliate rate is configured", async () => {
        const tx = makeTx({
            attributions: { p1: { id: "at-1", affiliateAppUserId: "aff-1" } },
            items: [{ productId: "p1", lineTotal: "100.00" }],
            rules: [],
        });

        const recorded = await AffiliateConversionService.recordConversionsForProductOrder(
            tx,
            "po1",
        );

        expect(recorded).toEqual([
            {
                productId: "p1",
                affiliateAppUserId: "aff-1",
                amount: 0,
                credited: false,
            },
        ]);
        expect(tx.walletTransaction.create).not.toHaveBeenCalled();
        expect(tx.earningTransaction.create).not.toHaveBeenCalled();
    });

    it.each([
        [ProductOrderStatus.SHIPPED, ProductPaymentStatus.PAID],
        [ProductOrderStatus.DELIVERED, ProductPaymentStatus.UNPAID],
        [ProductOrderStatus.CANCELLED, ProductPaymentStatus.PAID],
    ])(
        "pays nothing for a %s / %s order",
        async (orderStatus, paymentStatus) => {
            const tx = makeTx({
                orderStatus,
                paymentStatus,
                attributions: { p1: { id: "at-1", affiliateAppUserId: "aff-1" } },
                rules: [productRule(EarningRuleType.PERCENTAGE, "10")],
            });

            const recorded =
                await AffiliateConversionService.recordConversionsForProductOrder(
                    tx,
                    "po1",
                );

            expect(recorded).toEqual([]);
            expect(tx.affiliateConversion.create).not.toHaveBeenCalled();
            expect(tx.walletTransaction.create).not.toHaveBeenCalled();
        },
    );

    it("pays nothing for a product the customer was never attributed to", async () => {
        const tx = makeTx({
            attributions: { p1: { id: "at-1", affiliateAppUserId: "aff-1" } },
            items: [
                { productId: "p1", lineTotal: "100.00" },
                { productId: "p9", lineTotal: "80.00" },
            ],
            rules: [productRule(EarningRuleType.PERCENTAGE, "10")],
        });

        const recorded = await AffiliateConversionService.recordConversionsForProductOrder(
            tx,
            "po1",
        );

        expect(recorded).toHaveLength(1);
        expect(tx.affiliateConversion.create).toHaveBeenCalledTimes(1);
        expect(tx.affiliateConversion.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ productId: "p1" }),
            }),
        );
    });

    it("records the conversion against the AFFILIATE program with a frozen snapshot", async () => {
        const tx = makeTx({
            attributions: { p1: { id: "at-1", affiliateAppUserId: "aff-1" } },
            items: [{ productId: "p1", lineTotal: "100.00" }],
            rules: [productRule(EarningRuleType.PERCENTAGE, "10")],
        });

        await AffiliateConversionService.recordConversionsForProductOrder(tx, "po1");

        expect(tx.earningTransaction.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    program: EarningProgram.AFFILIATE,
                    walletReason: WalletTransactionReason.AFFILIATE_COMMISSION,
                    idempotencyKey: "AFFILIATE_CONVERSION:po1:p1:aff-1",
                    productOrderId: "po1",
                }),
            }),
        );
        expect(tx.walletTransaction.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    userId: "affiliate-auth",
                    type: WalletTransactionType.CREDIT,
                    reason: WalletTransactionReason.AFFILIATE_COMMISSION,
                    amount: 10,
                }),
            }),
        );
        expect(tx.affiliateConversion.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    status: EarningStatus.AVAILABLE,
                    earningTransactionId: expect.any(String),
                }),
            }),
        );
    });

    it("honours a FIXED rule", async () => {
        const tx = makeTx({
            attributions: { p1: { id: "at-1", affiliateAppUserId: "aff-1" } },
            items: [{ productId: "p1", lineTotal: "100.00" }],
            rules: [productRule(EarningRuleType.FIXED, "25")],
        });

        const recorded = await AffiliateConversionService.recordConversionsForProductOrder(
            tx,
            "po1",
        );

        expect(recorded[0].amount).toBe(25);
    });
});

describe("revokeConversionsForProductOrder", () => {
    it("freezes the conversions without touching the wallet", async () => {
        const tx = makeTx();
        (tx.affiliateConversion as unknown as { updateMany: ReturnType<typeof vi.fn> })
            .updateMany = vi.fn().mockResolvedValue({ count: 2 });

        const count = await AffiliateConversionService.revokeConversionsForProductOrder(
            tx,
            "po1",
        );

        expect(count).toBe(2);
        expect(tx.walletTransaction.create).not.toHaveBeenCalled();
    });
});
