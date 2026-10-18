import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    EarningRuleScope,
    EarningRuleType,
    ProductOrderStatus,
    ProductPaymentMethod,
    ProductPaymentStatus,
    ProductStatus,
    Role,
    WalletTransactionReason,
} from "../../../../generated/prisma/enums";
import type { IRequestUser } from "../../../interfaces/requestUser.interface";
import type { ICheckoutPayload } from "./productOrder.interface";
import { ProductOrderService } from "./productOrder.service";

// The service only talks to Prisma, which is mocked here. The inventory delegate
// deliberately exposes ONLY the conditional `updateMany`: a read-then-write
// stock update would fail loudly against this mock.
const mocks = vi.hoisted(() => ({
    transaction: vi.fn(),
    productOrderFindUnique: vi.fn(),
    productOrderFindFirst: vi.fn(),
    productOrderFindUniqueOrThrow: vi.fn(),
    productOrderCreate: vi.fn(),
    productOrderUpdateMany: vi.fn(),
    productOrderFindMany: vi.fn(),
    productOrderCount: vi.fn(),
    cartFindUnique: vi.fn(),
    cartItemDeleteMany: vi.fn(),
    inventoryUpdateMany: vi.fn(),
    shippingAddressFindFirst: vi.fn(),
    // Affiliate settlement hooks (only reached once an order is DELIVERED + PAID).
    productOrderItemFindMany: vi.fn(),
    affiliateAttributionFindUnique: vi.fn(),
    affiliateConversionFindUnique: vi.fn(),
    affiliateConversionCreate: vi.fn(),
    affiliateConversionUpdate: vi.fn(),
    affiliateConversionUpdateMany: vi.fn(),
    commissionRuleFindMany: vi.fn(),
    appUserFindUniqueOrThrow: vi.fn(),
    earningTransactionFindUnique: vi.fn(),
    earningTransactionCreate: vi.fn(),
    earningTransactionUpdateMany: vi.fn(),
    earningTransactionFindUniqueOrThrow: vi.fn(),
    walletTransactionCreate: vi.fn(),
    appUserUpdate: vi.fn(),
}));

vi.mock("../../../lib/prisma", () => {
    const client = {
        productOrder: {
            findUnique: mocks.productOrderFindUnique,
            findFirst: mocks.productOrderFindFirst,
            findUniqueOrThrow: mocks.productOrderFindUniqueOrThrow,
            create: mocks.productOrderCreate,
            updateMany: mocks.productOrderUpdateMany,
            findMany: mocks.productOrderFindMany,
            count: mocks.productOrderCount,
        },
        cart: { findUnique: mocks.cartFindUnique },
        cartItem: { deleteMany: mocks.cartItemDeleteMany },
        inventory: { updateMany: mocks.inventoryUpdateMany },
        shippingAddress: { findFirst: mocks.shippingAddressFindFirst },
        productOrderItem: { findMany: mocks.productOrderItemFindMany },
        affiliateAttribution: { findUnique: mocks.affiliateAttributionFindUnique },
        affiliateConversion: {
            findUnique: mocks.affiliateConversionFindUnique,
            create: mocks.affiliateConversionCreate,
            update: mocks.affiliateConversionUpdate,
            updateMany: mocks.affiliateConversionUpdateMany,
        },
        commissionRule: { findMany: mocks.commissionRuleFindMany },
        appUser: {
            findUniqueOrThrow: mocks.appUserFindUniqueOrThrow,
            update: mocks.appUserUpdate,
        },
        earningTransaction: {
            findUnique: mocks.earningTransactionFindUnique,
            create: mocks.earningTransactionCreate,
            updateMany: mocks.earningTransactionUpdateMany,
            findUniqueOrThrow: mocks.earningTransactionFindUniqueOrThrow,
        },
        walletTransaction: { create: mocks.walletTransactionCreate },
        // Interactive transaction: the callback receives the same mocked client,
        // so every statement inside it is observable.
        $transaction: (fn: (tx: unknown) => unknown) =>
            mocks.transaction(fn, client),
    };

    return { prisma: client };
});

const user: IRequestUser = {
    userId: "u1",
    role: Role.USER,
    email: "u1@example.com",
};

const payload = (
    overrides: Partial<ICheckoutPayload> = {},
): ICheckoutPayload => ({
    idempotencyKey: "checkout-attempt-0001",
    addressId: "addr-1",
    ...overrides,
});

const savedAddress = (overrides: Record<string, unknown> = {}) => ({
    id: "addr-1",
    userId: "u1",
    recipientName: "Karim Ahmed",
    phone: "+8801712345678",
    division: "Dhaka",
    district: "Dhaka",
    upazila: "Gulshan",
    unionArea: null,
    villageRoad: null,
    postalCode: "1212",
    isDeleted: false,
    ...overrides,
});

const cartItemRow = (overrides: Record<string, unknown> = {}) => ({
    id: "ci1",
    cartId: "cart1",
    variantId: "v1",
    quantity: 3,
    variant: {
        id: "v1",
        sku: "SKU-1",
        name: "Standard",
        price: 10.1,
        isActive: true,
        isDeleted: false,
        product: {
            id: "p1",
            name: "Smartphone",
            status: ProductStatus.ACTIVE,
            isActive: true,
            isDeleted: false,
        },
    },
    ...overrides,
});

const cart = (overrides: Record<string, unknown> = {}) => ({
    id: "cart1",
    userId: "u1",
    items: [cartItemRow()],
    ...overrides,
});

const orderRow = (overrides: Record<string, unknown> = {}) => ({
    id: "o1",
    orderNumber: "RZQ-20261018-000001",
    userId: "u1",
    status: ProductOrderStatus.PENDING,
    paymentMethod: ProductPaymentMethod.COD,
    paymentStatus: ProductPaymentStatus.UNPAID,
    paidAt: null,
    idempotencyKey: "checkout-attempt-0001",
    subtotal: 30.5,
    discountAmount: 0,
    shippingAmount: 0,
    grandTotal: 30.5,
    currency: "bdt",
    shippingRecipientName: "Karim Ahmed",
    shippingPhone: "+8801712345678",
    shippingDivision: "Dhaka",
    shippingDistrict: "Dhaka",
    shippingUpazila: "Gulshan",
    shippingUnionArea: null,
    shippingVillageRoad: null,
    shippingPostalCode: "1212",
    customerNote: null,
    createdAt: new Date("2026-10-18T00:00:00.000Z"),
    updatedAt: new Date("2026-10-18T00:00:00.000Z"),
    items: [],
    ...overrides,
});

interface CreatedOrderData {
    orderNumber: string;
    status: string;
    paymentMethod: string;
    paymentStatus: string;
    paidAt: null;
    idempotencyKey: string;
    subtotal: string;
    discountAmount: string;
    shippingAmount: string;
    grandTotal: string;
    shippingRecipientName: string;
    shippingPhone: string;
    shippingDivision: string;
    shippingDistrict: string;
    items: {
        create: {
            variantId: string;
            productId: string;
            productName: string;
            variantName: string | null;
            sku: string;
            unitPrice: string;
            quantity: number;
            lineTotal: string;
        }[];
    };
}

const firstCreateData = (): CreatedOrderData =>
    mocks.productOrderCreate.mock.calls[0]?.[0]?.data as CreatedOrderData;

const happyPath = () => {
    mocks.productOrderFindUnique.mockResolvedValue(null);
    mocks.cartFindUnique.mockResolvedValue(cart());
    mocks.shippingAddressFindFirst.mockResolvedValue(savedAddress());
    mocks.inventoryUpdateMany.mockResolvedValue({ count: 1 });
    mocks.productOrderCreate.mockResolvedValue(orderRow());
    mocks.cartItemDeleteMany.mockResolvedValue({ count: 1 });
};

beforeEach(() => {
    vi.resetAllMocks();
    mocks.transaction.mockImplementation(
        (fn: (tx: unknown) => unknown, client: unknown) => fn(client),
    );
});

describe("ProductOrderService.checkout", () => {
    it("places a COD order from the caller's cart", async () => {
        happyPath();

        const result = await ProductOrderService.checkout(user, payload());

        expect(result.idempotent).toBe(false);
        expect(result.order).toMatchObject({
            id: "o1",
            orderNumber: "RZQ-20261018-000001",
            status: ProductOrderStatus.PENDING,
            paymentMethod: ProductPaymentMethod.COD,
            paymentStatus: ProductPaymentStatus.UNPAID,
            paidAt: null,
            grandTotal: 30.5,
        });

        // The whole flow runs inside one transaction.
        expect(mocks.transaction).toHaveBeenCalledTimes(1);
    });

    it("never leaks the owner id or the idempotency key to the client", async () => {
        happyPath();

        const result = await ProductOrderService.checkout(user, payload());

        expect(result.order).not.toHaveProperty("userId");
        expect(result.order).not.toHaveProperty("idempotencyKey");
    });

    it("starts a COD order UNPAID with no collection timestamp", async () => {
        happyPath();

        await ProductOrderService.checkout(user, payload());

        const data = firstCreateData();

        expect(data.paymentMethod).toBe(ProductPaymentMethod.COD);
        expect(data.paymentStatus).toBe(ProductPaymentStatus.UNPAID);
        expect(data.paidAt).toBeNull();
        expect(data.status).toBe(ProductOrderStatus.PENDING);
    });

    it("generates a unique human-readable order number", async () => {
        happyPath();

        await ProductOrderService.checkout(user, payload());

        expect(firstCreateData().orderNumber).toMatch(/^RZQ-\d{8}-\d{6}$/);
    });

    it("writes money as fixed 2-decimal strings computed from database prices", async () => {
        mocks.productOrderFindUnique.mockResolvedValue(null);
        mocks.cartFindUnique.mockResolvedValue(
            cart({
                items: [
                    cartItemRow({ quantity: 3 }),
                    cartItemRow({
                        id: "ci2",
                        variantId: "v2",
                        quantity: 1,
                        variant: {
                            ...cartItemRow().variant,
                            id: "v2",
                            sku: "SKU-2",
                            price: 0.2,
                        },
                    }),
                ],
            }),
        );
        mocks.shippingAddressFindFirst.mockResolvedValue(savedAddress());
        mocks.inventoryUpdateMany.mockResolvedValue({ count: 1 });
        mocks.productOrderCreate.mockResolvedValue(orderRow());
        mocks.cartItemDeleteMany.mockResolvedValue({ count: 2 });

        await ProductOrderService.checkout(user, payload());

        const data = firstCreateData();

        // 10.10 * 3 + 0.20 = 30.50 exactly, never 30.499999999999996.
        expect(data.subtotal).toBe("30.50");
        expect(data.shippingAmount).toBe("0.00");
        expect(data.discountAmount).toBe("0.00");
        expect(data.grandTotal).toBe("30.50");
        expect(data.items.create).toHaveLength(2);
        expect(data.items.create[0]).toMatchObject({
            variantId: "v1",
            sku: "SKU-1",
            unitPrice: "10.10",
            quantity: 3,
            lineTotal: "30.30",
        });
        expect(data.items.create[1]).toMatchObject({
            variantId: "v2",
            unitPrice: "0.20",
            lineTotal: "0.20",
        });
    });

    it("snapshots the purchase-time product, variant and SKU", async () => {
        happyPath();

        await ProductOrderService.checkout(user, payload());

        expect(firstCreateData().items.create[0]).toMatchObject({
            productId: "p1",
            productName: "Smartphone",
            variantName: "Standard",
            sku: "SKU-1",
        });
    });

    it("ignores every client-supplied price, total, stock and status field", async () => {
        happyPath();

        const tampered = {
            ...payload(),
            unitPrice: 0.01,
            lineTotal: 0.01,
            subtotal: 0.01,
            grandTotal: 0.01,
            status: ProductOrderStatus.DELIVERED,
            paymentStatus: ProductPaymentStatus.PAID,
            paidAt: new Date(),
            availableQuantity: 9999,
            userId: "u2",
            orderNumber: "RZQ-19700101-000000",
            items: [{ sku: "SKU-1", unitPrice: 0.01, quantity: 99 }],
        } as unknown as ICheckoutPayload;

        await ProductOrderService.checkout(user, tampered);

        const data = firstCreateData();

        expect(data.grandTotal).toBe("30.30");
        expect(data.status).toBe(ProductOrderStatus.PENDING);
        expect(data.paymentStatus).toBe(ProductPaymentStatus.UNPAID);
        expect(data.idempotencyKey).toBe("checkout-attempt-0001");
        expect(data.items.create[0]?.unitPrice).toBe("10.10");
        expect(mocks.inventoryUpdateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                data: { availableQuantity: { decrement: 3 } },
            }),
        );
    });

    it("uses a conditional atomic decrement instead of a read-then-write", async () => {
        happyPath();

        await ProductOrderService.checkout(user, payload());

        // The guard and the write are the same statement, so concurrent checkouts
        // cannot both pass it and oversell.
        expect(mocks.inventoryUpdateMany).toHaveBeenCalledWith({
            where: { variantId: "v1", availableQuantity: { gte: 3 } },
            data: { availableQuantity: { decrement: 3 } },
        });
    });

    it("clears the purchased cart lines only after stock and the order are persisted", async () => {
        happyPath();

        await ProductOrderService.checkout(user, payload());

        const decrementAt = mocks.inventoryUpdateMany.mock.invocationCallOrder[0]!;
        const createAt = mocks.productOrderCreate.mock.invocationCallOrder[0]!;
        const clearAt = mocks.cartItemDeleteMany.mock.invocationCallOrder[0]!;

        expect(decrementAt).toBeLessThan(createAt);
        expect(createAt).toBeLessThan(clearAt);
        expect(mocks.cartItemDeleteMany).toHaveBeenCalledWith({
            where: { cartId: "cart1", id: { in: ["ci1"] } },
        });
    });

    it("returns the existing order for a repeated idempotency key", async () => {
        mocks.productOrderFindUnique.mockResolvedValue(orderRow({ id: "existing" }));

        const result = await ProductOrderService.checkout(user, payload());

        expect(result.idempotent).toBe(true);
        expect(result.order.id).toBe("existing");
        // No second order, no second deduction, no second cart cleanup.
        expect(mocks.transaction).not.toHaveBeenCalled();
        expect(mocks.inventoryUpdateMany).not.toHaveBeenCalled();
        expect(mocks.productOrderCreate).not.toHaveBeenCalled();
        expect(mocks.cartItemDeleteMany).not.toHaveBeenCalled();
        expect(mocks.cartFindUnique).not.toHaveBeenCalled();
    });

    it("scopes the idempotency lookup to the authenticated user", async () => {
        mocks.productOrderFindUnique.mockResolvedValue(null);
        mocks.cartFindUnique.mockResolvedValue(cart({ items: [] }));

        await expect(
            ProductOrderService.checkout(user, payload()),
        ).rejects.toMatchObject({ statusCode: 400 });

        expect(mocks.productOrderFindUnique).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    uniq_product_order_user_idempotency_key: {
                        userId: "u1",
                        idempotencyKey: "checkout-attempt-0001",
                    },
                },
            }),
        );
    });

    it("rejects an empty cart", async () => {
        mocks.productOrderFindUnique.mockResolvedValue(null);
        mocks.cartFindUnique.mockResolvedValue(cart({ items: [] }));

        await expect(
            ProductOrderService.checkout(user, payload()),
        ).rejects.toMatchObject({ statusCode: 400 });

        expect(mocks.inventoryUpdateMany).not.toHaveBeenCalled();
        expect(mocks.productOrderCreate).not.toHaveBeenCalled();
        expect(mocks.cartItemDeleteMany).not.toHaveBeenCalled();
    });

    it("rejects a caller who has no cart at all", async () => {
        mocks.productOrderFindUnique.mockResolvedValue(null);
        mocks.cartFindUnique.mockResolvedValue(null);

        await expect(
            ProductOrderService.checkout(user, payload()),
        ).rejects.toMatchObject({ statusCode: 400 });

        expect(mocks.productOrderCreate).not.toHaveBeenCalled();
    });

    it.each([
        ["a deactivated variant", { isActive: false }],
        [
            "an archived product",
            {
                product: {
                    id: "p1",
                    name: "Smartphone",
                    status: ProductStatus.ARCHIVED,
                    isActive: false,
                    isDeleted: false,
                },
            },
        ],
        [
            "a soft-deleted product",
            {
                product: {
                    id: "p1",
                    name: "Smartphone",
                    status: ProductStatus.ACTIVE,
                    isActive: true,
                    isDeleted: true,
                },
            },
        ],
    ])("refuses to check out %s", async (_label, variantOverrides) => {
        mocks.productOrderFindUnique.mockResolvedValue(null);
        mocks.cartFindUnique.mockResolvedValue(
            cart({
                items: [
                    cartItemRow({
                        variant: {
                            ...cartItemRow().variant,
                            ...(variantOverrides as Record<string, unknown>),
                        },
                    }),
                ],
            }),
        );
        mocks.shippingAddressFindFirst.mockResolvedValue(savedAddress());

        await expect(
            ProductOrderService.checkout(user, payload()),
        ).rejects.toMatchObject({ statusCode: 400 });

        expect(mocks.inventoryUpdateMany).not.toHaveBeenCalled();
        expect(mocks.productOrderCreate).not.toHaveBeenCalled();
        expect(mocks.cartItemDeleteMany).not.toHaveBeenCalled();
    });

    it.each([0, 150])(
        "rejects the out-of-range cart quantity %s that the API could not have created",
        async (quantity) => {
            mocks.productOrderFindUnique.mockResolvedValue(null);
            mocks.cartFindUnique.mockResolvedValue(
                cart({ items: [cartItemRow({ quantity })] }),
            );
            mocks.shippingAddressFindFirst.mockResolvedValue(savedAddress());

            await expect(
                ProductOrderService.checkout(user, payload()),
            ).rejects.toMatchObject({ statusCode: 400 });

            expect(mocks.inventoryUpdateMany).not.toHaveBeenCalled();
        },
    );

    it("uses the caller's own saved address as the delivery snapshot", async () => {
        happyPath();

        await ProductOrderService.checkout(user, payload({ addressId: "addr-1" }));

        expect(mocks.shippingAddressFindFirst).toHaveBeenCalledWith({
            where: { id: "addr-1", userId: "u1", isDeleted: false },
        });
        expect(firstCreateData()).toMatchObject({
            shippingRecipientName: "Karim Ahmed",
            shippingPhone: "+8801712345678",
            shippingDivision: "Dhaka",
            shippingDistrict: "Dhaka",
        });
    });

    it("reports another user's address as missing without touching stock", async () => {
        mocks.productOrderFindUnique.mockResolvedValue(null);
        mocks.cartFindUnique.mockResolvedValue(cart());
        mocks.shippingAddressFindFirst.mockResolvedValue(null);

        await expect(
            ProductOrderService.checkout(user, payload({ addressId: "addr-of-u2" })),
        ).rejects.toMatchObject({ statusCode: 404 });

        expect(mocks.inventoryUpdateMany).not.toHaveBeenCalled();
        expect(mocks.productOrderCreate).not.toHaveBeenCalled();
        expect(mocks.cartItemDeleteMany).not.toHaveBeenCalled();
    });

    it("accepts a validated inline delivery snapshot", async () => {
        mocks.productOrderFindUnique.mockResolvedValue(null);
        mocks.cartFindUnique.mockResolvedValue(cart());
        mocks.inventoryUpdateMany.mockResolvedValue({ count: 1 });
        mocks.productOrderCreate.mockResolvedValue(orderRow());
        mocks.cartItemDeleteMany.mockResolvedValue({ count: 1 });

        await ProductOrderService.checkout(
            user,
            payload({
                addressId: undefined,
                shippingAddress: {
                    recipientName: "Rina Akter",
                    phone: "01911111111",
                    division: "Chattogram",
                    district: "Chattogram",
                    upazila: "Pahartali",
                },
            }),
        );

        expect(mocks.shippingAddressFindFirst).not.toHaveBeenCalled();
        expect(firstCreateData()).toMatchObject({
            shippingRecipientName: "Rina Akter",
            shippingDivision: "Chattogram",
        });
    });

    it("rejects the checkout when an item is out of stock", async () => {
        mocks.productOrderFindUnique.mockResolvedValue(null);
        mocks.cartFindUnique.mockResolvedValue(cart());
        mocks.shippingAddressFindFirst.mockResolvedValue(savedAddress());
        mocks.inventoryUpdateMany.mockResolvedValue({ count: 0 });

        await expect(
            ProductOrderService.checkout(user, payload()),
        ).rejects.toMatchObject({ statusCode: 409 });

        expect(mocks.productOrderCreate).not.toHaveBeenCalled();
        expect(mocks.cartItemDeleteMany).not.toHaveBeenCalled();
    });

    it("rolls the whole transaction back when a later line cannot be decremented", async () => {
        mocks.productOrderFindUnique.mockResolvedValue(null);
        mocks.cartFindUnique.mockResolvedValue(
            cart({
                items: [
                    cartItemRow({ quantity: 1 }),
                    cartItemRow({
                        id: "ci2",
                        variantId: "v2",
                        quantity: 5,
                        variant: {
                            ...cartItemRow().variant,
                            id: "v2",
                            sku: "SKU-2",
                        },
                    }),
                ],
            }),
        );
        mocks.shippingAddressFindFirst.mockResolvedValue(savedAddress());
        mocks.inventoryUpdateMany
            .mockResolvedValueOnce({ count: 1 })
            .mockResolvedValueOnce({ count: 0 });

        await expect(
            ProductOrderService.checkout(user, payload()),
        ).rejects.toMatchObject({ statusCode: 409 });

        // The failure is thrown from inside the transaction (so PostgreSQL undoes
        // the first deduction along with everything else), and nothing after the
        // failing line ever ran.
        expect(mocks.transaction).toHaveBeenCalledTimes(1);
        expect(mocks.inventoryUpdateMany).toHaveBeenCalledTimes(2);
        expect(mocks.productOrderCreate).not.toHaveBeenCalled();
        expect(mocks.cartItemDeleteMany).not.toHaveBeenCalled();
    });

    it("refuses the second of two concurrent checkouts for the last unit", async () => {
        mocks.productOrderFindUnique.mockResolvedValue(null);
        mocks.cartFindUnique.mockResolvedValue(
            cart({ items: [cartItemRow({ quantity: 1 })] }),
        );
        mocks.shippingAddressFindFirst.mockResolvedValue(savedAddress());
        mocks.inventoryUpdateMany
            .mockResolvedValueOnce({ count: 1 })
            .mockResolvedValueOnce({ count: 0 });
        mocks.productOrderCreate.mockResolvedValue(orderRow());
        mocks.cartItemDeleteMany.mockResolvedValue({ count: 1 });

        const [first, second] = await Promise.allSettled([
            ProductOrderService.checkout(user, payload()),
            ProductOrderService.checkout(user, payload()),
        ]);

        expect(first.status).toBe("fulfilled");
        expect(second.status).toBe("rejected");
        expect(mocks.productOrderCreate).toHaveBeenCalledTimes(1);
    });

    it("retries with a fresh order number when one collides", async () => {
        happyPath();
        mocks.productOrderCreate
            .mockRejectedValueOnce({ code: "P2002" })
            .mockResolvedValueOnce(orderRow());

        const result = await ProductOrderService.checkout(user, payload());

        expect(result.order.id).toBe("o1");
        expect(mocks.productOrderCreate).toHaveBeenCalledTimes(2);

        const firstNumber = mocks.productOrderCreate.mock.calls[0]?.[0]?.data
            ?.orderNumber as string;
        const secondNumber = mocks.productOrderCreate.mock.calls[1]?.[0]?.data
            ?.orderNumber as string;

        expect(firstNumber).not.toBe(secondNumber);
    });

    it("returns the winner's order when a concurrent request claims the same key", async () => {
        // Outer pre-check misses, the in-transaction check misses, the insert
        // loses the race, and the post-failure lookup finds the winner.
        mocks.productOrderFindUnique
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(orderRow({ id: "winner" }));
        mocks.cartFindUnique.mockResolvedValue(cart());
        mocks.shippingAddressFindFirst.mockResolvedValue(savedAddress());
        mocks.inventoryUpdateMany.mockResolvedValue({ count: 1 });
        mocks.productOrderCreate.mockRejectedValue({ code: "P2002" });

        const result = await ProductOrderService.checkout(user, payload());

        expect(result.idempotent).toBe(true);
        expect(result.order.id).toBe("winner");
        expect(mocks.productOrderCreate).toHaveBeenCalledTimes(1);
    });

    it("gives up after repeated order-number collisions", async () => {
        mocks.productOrderFindUnique.mockResolvedValue(null);
        mocks.cartFindUnique.mockResolvedValue(cart());
        mocks.shippingAddressFindFirst.mockResolvedValue(savedAddress());
        mocks.inventoryUpdateMany.mockResolvedValue({ count: 1 });
        mocks.productOrderCreate.mockRejectedValue({ code: "P2002" });

        await expect(
            ProductOrderService.checkout(user, payload()),
        ).rejects.toMatchObject({ statusCode: 500 });

        expect(mocks.productOrderCreate).toHaveBeenCalledTimes(5);
        expect(mocks.cartItemDeleteMany).not.toHaveBeenCalled();
    });

    it("propagates a non-unique database failure instead of retrying", async () => {
        happyPath();
        mocks.productOrderCreate.mockRejectedValue({ code: "P2004" });

        await expect(
            ProductOrderService.checkout(user, payload()),
        ).rejects.toMatchObject({ code: "P2004" });

        expect(mocks.productOrderCreate).toHaveBeenCalledTimes(1);
    });
});

describe("ProductOrderService order reads", () => {
    it("scopes a single order to its owner", async () => {
        mocks.productOrderFindFirst.mockResolvedValue(null);

        await expect(
            ProductOrderService.getMyOrder(user, "order-of-u2"),
        ).rejects.toMatchObject({ statusCode: 404 });

        expect(mocks.productOrderFindFirst).toHaveBeenCalledWith({
            where: { id: "order-of-u2", userId: "u1" },
            include: expect.anything(),
        });
    });

    it("returns the caller's own order without internal fields", async () => {
        mocks.productOrderFindFirst.mockResolvedValue(
            orderRow({ items: [{ id: "oi1" }] }),
        );

        const view = await ProductOrderService.getMyOrder(user, "o1");

        expect(view.id).toBe("o1");
        expect(view.grandTotal).toBe(30.5);
        expect(view).not.toHaveProperty("userId");
        expect(view).not.toHaveProperty("idempotencyKey");
    });

    it("forces the owner filter after the client filters on the list", async () => {
        mocks.productOrderFindMany.mockResolvedValue([]);
        mocks.productOrderCount.mockResolvedValue(0);

        await ProductOrderService.getMyOrders(user, {
            status: ProductOrderStatus.PENDING,
            // Not a filterable field, so it is dropped rather than trusted.
            userId: "u2",
        } as never);

        const args = mocks.productOrderFindMany.mock.calls[0]?.[0] as {
            where: Record<string, unknown>;
        };

        expect(args.where).toMatchObject({
            status: ProductOrderStatus.PENDING,
            userId: "u1",
        });
        expect(args.where.userId).toBe("u1");
    });

    it("maps the caller's list through the public projection", async () => {
        mocks.productOrderFindMany.mockResolvedValue([orderRow()]);
        mocks.productOrderCount.mockResolvedValue(1);

        const result = await ProductOrderService.getMyOrders(user, {} as never);

        expect(result.meta).toMatchObject({ total: 1 });
        expect(result.data[0]).not.toHaveProperty("userId");
        expect(result.data[0]?.grandTotal).toBe(30.5);
    });

    it("does not force an owner filter on the staff list", async () => {
        mocks.productOrderFindMany.mockResolvedValue([]);
        mocks.productOrderCount.mockResolvedValue(0);

        await ProductOrderService.getAllProductOrders({} as never);

        const args = mocks.productOrderFindMany.mock.calls[0]?.[0] as {
            where: Record<string, unknown>;
        };

        expect(args.where).not.toHaveProperty("userId");
    });

    it("exposes the buyer id to staff", async () => {
        mocks.productOrderFindMany.mockResolvedValue([orderRow()]);
        mocks.productOrderCount.mockResolvedValue(1);

        const result = await ProductOrderService.getAllProductOrders({} as never);

        expect(result.data[0]?.userId).toBe("u1");
    });

    it("reports an unknown order as missing for staff too", async () => {
        mocks.productOrderFindUnique.mockResolvedValue(null);

        await expect(
            ProductOrderService.getProductOrderById("missing"),
        ).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe("ProductOrderService.updateOrderStatus", () => {
    const statusUpdate = (current: ProductOrderStatus, next: ProductOrderStatus) => {
        mocks.productOrderFindUnique.mockResolvedValue({
            id: "o1",
            status: current,
        });
        mocks.productOrderUpdateMany.mockResolvedValue({ count: 1 });
        mocks.productOrderFindUniqueOrThrow.mockResolvedValue(
            orderRow({ status: next }),
        );
    };

    it("reports an unknown order as missing", async () => {
        mocks.productOrderFindUnique.mockResolvedValue(null);

        await expect(
            ProductOrderService.updateOrderStatus(
                "missing",
                ProductOrderStatus.CONFIRMED,
            ),
        ).rejects.toMatchObject({ statusCode: 404 });
    });

    it("applies one forward step of the fulfilment flow", async () => {
        statusUpdate(ProductOrderStatus.PENDING, ProductOrderStatus.CONFIRMED);

        const view = await ProductOrderService.updateOrderStatus(
            "o1",
            ProductOrderStatus.CONFIRMED,
        );

        expect(view.status).toBe(ProductOrderStatus.CONFIRMED);
        // The current status is part of the WHERE, so concurrent transitions
        // cannot both apply.
        expect(mocks.productOrderUpdateMany).toHaveBeenCalledWith({
            where: { id: "o1", status: ProductOrderStatus.PENDING },
            data: { status: ProductOrderStatus.CONFIRMED },
        });
    });

    it.each([
        [ProductOrderStatus.PENDING, ProductOrderStatus.SHIPPED],
        [ProductOrderStatus.PENDING, ProductOrderStatus.DELIVERED],
        [ProductOrderStatus.DELIVERED, ProductOrderStatus.SHIPPED],
        [ProductOrderStatus.PENDING, ProductOrderStatus.PENDING],
    ])("refuses the invalid transition %s -> %s", async (current, next) => {
        mocks.productOrderFindUnique.mockResolvedValue({ id: "o1", status: current });

        await expect(
            ProductOrderService.updateOrderStatus("o1", next),
        ).rejects.toMatchObject({ statusCode: 400 });

        expect(mocks.productOrderUpdateMany).not.toHaveBeenCalled();
    });

    it("refuses cancellation while no cancellation/restock rule exists", async () => {
        mocks.productOrderFindUnique.mockResolvedValue({
            id: "o1",
            status: ProductOrderStatus.PENDING,
        });

        await expect(
            ProductOrderService.updateOrderStatus(
                "o1",
                ProductOrderStatus.CANCELLED,
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it("reports a concurrent transition instead of skipping a step", async () => {
        mocks.productOrderFindUnique.mockResolvedValue({
            id: "o1",
            status: ProductOrderStatus.PENDING,
        });
        mocks.productOrderUpdateMany.mockResolvedValue({ count: 0 });

        await expect(
            ProductOrderService.updateOrderStatus(
                "o1",
                ProductOrderStatus.CONFIRMED,
            ),
        ).rejects.toMatchObject({ statusCode: 409 });
    });

    it("does not touch stock or payment when fulfilment advances", async () => {
        statusUpdate(ProductOrderStatus.SHIPPED, ProductOrderStatus.DELIVERED);

        await ProductOrderService.updateOrderStatus(
            "o1",
            ProductOrderStatus.DELIVERED,
        );

        const data = mocks.productOrderUpdateMany.mock.calls[0]?.[0]?.data as
            | Record<string, unknown>
            | undefined;

        expect(data).toEqual({ status: ProductOrderStatus.DELIVERED });
        expect(data).not.toHaveProperty("paymentStatus");
        expect(mocks.inventoryUpdateMany).not.toHaveBeenCalled();
    });
});

describe("ProductOrderService.updateOrderPayment", () => {
    it("reports an unknown order as missing", async () => {
        mocks.productOrderFindUnique.mockResolvedValue(null);

        await expect(
            ProductOrderService.updateOrderPayment(
                "missing",
                ProductPaymentStatus.PAID,
            ),
        ).rejects.toMatchObject({ statusCode: 404 });
    });

    it("records cash collected for a delivered but unpaid order", async () => {
        mocks.productOrderFindUnique.mockResolvedValue({
            id: "o1",
            paymentStatus: ProductPaymentStatus.UNPAID,
        });
        mocks.productOrderUpdateMany.mockResolvedValue({ count: 1 });
        mocks.productOrderFindUniqueOrThrow.mockResolvedValue(
            orderRow({
                status: ProductOrderStatus.DELIVERED,
                paymentStatus: ProductPaymentStatus.PAID,
                paidAt: new Date("2026-10-20T00:00:00.000Z"),
            }),
        );

        const view = await ProductOrderService.updateOrderPayment(
            "o1",
            ProductPaymentStatus.PAID,
        );

        expect(view.paymentStatus).toBe(ProductPaymentStatus.PAID);
        expect(view.status).toBe(ProductOrderStatus.DELIVERED);

        const args = mocks.productOrderUpdateMany.mock.calls[0]?.[0] as {
            where: Record<string, unknown>;
            data: Record<string, unknown>;
        };

        expect(args.where).toEqual({
            id: "o1",
            paymentStatus: ProductPaymentStatus.UNPAID,
        });
        expect(args.data.paymentStatus).toBe(ProductPaymentStatus.PAID);
        expect(args.data.paidAt).toBeInstanceOf(Date);
    });

    it("refuses to collect twice", async () => {
        mocks.productOrderFindUnique.mockResolvedValue({
            id: "o1",
            paymentStatus: ProductPaymentStatus.PAID,
        });

        await expect(
            ProductOrderService.updateOrderPayment("o1", ProductPaymentStatus.PAID),
        ).rejects.toMatchObject({ statusCode: 400 });

        expect(mocks.productOrderUpdateMany).not.toHaveBeenCalled();
    });

    it("reports a concurrent collection instead of double-recording it", async () => {
        mocks.productOrderFindUnique.mockResolvedValue({
            id: "o1",
            paymentStatus: ProductPaymentStatus.UNPAID,
        });
        mocks.productOrderUpdateMany.mockResolvedValue({ count: 0 });

        await expect(
            ProductOrderService.updateOrderPayment("o1", ProductPaymentStatus.PAID),
        ).rejects.toMatchObject({ statusCode: 409 });
    });
});

// Affiliate settlement is part of the same transaction as the state change, so a
// delivered+paid order can never lose its commission and a rolled-back state
// change can never pay one. Only a qualifying state settles.
describe("ProductOrderService affiliate settlement", () => {
    const earnings = new Map<string, Record<string, unknown>>();

    beforeEach(() => {
        earnings.clear();
        mocks.earningTransactionFindUnique.mockImplementation(
            async (args: { where: Record<string, string> }) => {
                // The idempotency lookup runs first; the id lookup is the realise step.
                if (args.where.idempotencyKey) return null;
                return earnings.get(args.where.id) ?? null;
            },
        );
        mocks.earningTransactionCreate.mockImplementation(
            async (args: { data: Record<string, unknown> }) => {
                const row: Record<string, unknown> = { id: "e-1", ...args.data };
                earnings.set("e-1", row);
                return row;
            },
        );
        mocks.earningTransactionUpdateMany.mockResolvedValue({ count: 1 });
        mocks.earningTransactionFindUniqueOrThrow.mockImplementation(
            async (args: { where: { id: string } }) => earnings.get(args.where.id),
        );
        mocks.appUserFindUniqueOrThrow.mockResolvedValue({
            id: "aff-app",
            authUserId: "affiliate-auth",
            balance: 0,
            totalEarned: 0,
        });
        mocks.appUserUpdate.mockResolvedValue({});
        mocks.walletTransactionCreate.mockResolvedValue({ id: "wt-1" });
        mocks.affiliateConversionCreate.mockResolvedValue({ id: "c-1" });
        mocks.affiliateConversionUpdate.mockResolvedValue({ id: "c-1" });
        mocks.affiliateConversionFindUnique.mockResolvedValue(null);
        mocks.productOrderItemFindMany.mockResolvedValue([
            { productId: "p1", lineTotal: "30.50" },
        ]);
        mocks.affiliateAttributionFindUnique.mockResolvedValue({
            id: "at-1",
            affiliateAppUserId: "aff-app",
            affiliateLinkId: "link-1",
        });
        mocks.commissionRuleFindMany.mockResolvedValue([
            {
                id: "rule-1",
                scope: EarningRuleScope.PRODUCT,
                ruleType: EarningRuleType.PERCENTAGE,
                value: "10",
                priority: 1,
                createdAt: new Date("2026-10-01"),
                productId: "p1",
                productVariantId: null,
                operatorOfferId: null,
            },
        ]);
    });

    it("settles the order's conversions inside the transition transaction", async () => {
        // The pre-check sees SHIPPED; the in-transaction read sees the new state.
        mocks.productOrderFindUnique
            .mockResolvedValueOnce({
                id: "o1",
                status: ProductOrderStatus.SHIPPED,
            })
            .mockResolvedValue({
                id: "o1",
                userId: "customer-user",
                status: ProductOrderStatus.DELIVERED,
                paymentStatus: ProductPaymentStatus.PAID,
            });
        mocks.productOrderUpdateMany.mockResolvedValue({ count: 1 });
        mocks.productOrderFindUniqueOrThrow.mockResolvedValue(
            orderRow({ status: ProductOrderStatus.DELIVERED }),
        );

        await ProductOrderService.updateOrderStatus(
            "o1",
            ProductOrderStatus.DELIVERED,
        );

        expect(mocks.transaction).toHaveBeenCalled();
        expect(mocks.affiliateConversionCreate).toHaveBeenCalledTimes(1);
        // 10% of 30.50 is 3.05, credited once through the shared ledger.
        expect(mocks.walletTransactionCreate).toHaveBeenCalledTimes(1);
        expect(mocks.walletTransactionCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    userId: "affiliate-auth",
                    reason: WalletTransactionReason.AFFILIATE_COMMISSION,
                    amount: 3.05,
                }),
            }),
        );
    });

    it("settles nothing for an in-progress transition", async () => {
        mocks.productOrderFindUnique.mockResolvedValue({
            id: "o1",
            userId: "customer-user",
            status: ProductOrderStatus.PENDING,
            paymentStatus: ProductPaymentStatus.UNPAID,
        });
        mocks.productOrderUpdateMany.mockResolvedValue({ count: 1 });
        mocks.productOrderFindUniqueOrThrow.mockResolvedValue(
            orderRow({ status: ProductOrderStatus.CONFIRMED }),
        );

        await ProductOrderService.updateOrderStatus(
            "o1",
            ProductOrderStatus.CONFIRMED,
        );

        expect(mocks.affiliateConversionCreate).not.toHaveBeenCalled();
        expect(mocks.walletTransactionCreate).not.toHaveBeenCalled();
    });

    it("settles nothing for a delivered but unpaid COD order", async () => {
        mocks.productOrderFindUnique
            .mockResolvedValueOnce({
                id: "o1",
                status: ProductOrderStatus.SHIPPED,
            })
            .mockResolvedValue({
                id: "o1",
                userId: "customer-user",
                status: ProductOrderStatus.DELIVERED,
                paymentStatus: ProductPaymentStatus.UNPAID,
            });
        mocks.productOrderUpdateMany.mockResolvedValue({ count: 1 });
        mocks.productOrderFindUniqueOrThrow.mockResolvedValue(
            orderRow({ status: ProductOrderStatus.SHIPPED }),
        );

        await ProductOrderService.updateOrderStatus(
            "o1",
            ProductOrderStatus.DELIVERED,
        );

        expect(mocks.affiliateConversionCreate).not.toHaveBeenCalled();
        expect(mocks.walletTransactionCreate).not.toHaveBeenCalled();
    });
});
