import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProductStatus, Role } from "../../../../generated/prisma/enums";
import type { IRequestUser } from "../../../interfaces/requestUser.interface";
import { CartService } from "./cart.service";

// The service only talks to Prisma, which is mocked here.
const mocks = vi.hoisted(() => ({
    cartFindUnique: vi.fn(),
    cartUpsert: vi.fn(),
    cartItemFindUnique: vi.fn(),
    cartItemUpsert: vi.fn(),
    cartItemFindFirst: vi.fn(),
    cartItemUpdate: vi.fn(),
    cartItemDeleteMany: vi.fn(),
    variantFindFirst: vi.fn(),
}));

vi.mock("../../../lib/prisma", () => ({
    prisma: {
        cart: {
            findUnique: mocks.cartFindUnique,
            upsert: mocks.cartUpsert,
        },
        cartItem: {
            findUnique: mocks.cartItemFindUnique,
            upsert: mocks.cartItemUpsert,
            findFirst: mocks.cartItemFindFirst,
            update: mocks.cartItemUpdate,
            deleteMany: mocks.cartItemDeleteMany,
        },
        productVariant: { findFirst: mocks.variantFindFirst },
    },
}));

const user: IRequestUser = {
    userId: "u1",
    role: Role.USER,
    email: "u1@example.com",
};

const activeVariant = (overrides: Record<string, unknown> = {}) => ({
    id: "v1",
    isActive: true,
    isDeleted: false,
    product: {
        id: "p1",
        status: ProductStatus.ACTIVE,
        isActive: true,
        isDeleted: false,
    },
    ...overrides,
});

const cartItem = (overrides: Record<string, unknown> = {}) => ({
    id: "i1",
    cartId: "cart1",
    variantId: "v1",
    quantity: 1,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    variant: {
        id: "v1",
        sku: "SKU-1",
        name: "Standard",
        price: 10.1,
        compareAtPrice: null,
        isActive: true,
        isDeleted: false,
        inventory: { availableQuantity: 5 },
        product: {
            id: "p1",
            name: "Smartphone",
            slug: "smartphone",
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
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    items: [],
    ...overrides,
});

beforeEach(() => {
    vi.resetAllMocks();
});

describe("CartService.getCart", () => {
    it("reads an empty cart for a user who has none, without writing anything", async () => {
        mocks.cartFindUnique.mockResolvedValue(null);

        const view = await CartService.getCart(user);

        expect(view).toEqual({
            id: null,
            userId: "u1",
            items: [],
            itemCount: 0,
            unitCount: 0,
            subtotal: 0,
            createdAt: null,
            updatedAt: null,
        });
        expect(mocks.cartUpsert).not.toHaveBeenCalled();
        expect(mocks.cartItemUpsert).not.toHaveBeenCalled();
    });

    it("scopes the lookup to the authenticated user", async () => {
        mocks.cartFindUnique.mockResolvedValue(null);

        await CartService.getCart(user);

        expect(mocks.cartFindUnique).toHaveBeenCalledWith(
            expect.objectContaining({ where: { userId: "u1" } }),
        );
    });

    it("sums the subtotal in paisa so decimals do not drift", async () => {
        mocks.cartFindUnique.mockResolvedValue(
            cart({
                items: [
                    cartItem({ id: "i1", quantity: 3 }),
                    cartItem({
                        id: "i2",
                        variantId: "v2",
                        quantity: 1,
                        variant: {
                            ...cartItem().variant,
                            id: "v2",
                            sku: "SKU-2",
                            price: 0.2,
                        },
                    }),
                ],
            }),
        );

        const view = await CartService.getCart(user);

        // 10.10 * 3 + 0.20 = 30.50, and never 30.499999999999996.
        expect(view.subtotal).toBe(30.5);
        expect(view.itemCount).toBe(2);
        expect(view.unitCount).toBe(4);
        expect(view.items[0]?.lineTotal).toBe(30.3);
    });

    it("flags an item whose variant is no longer purchasable", async () => {
        mocks.cartFindUnique.mockResolvedValue(
            cart({
                items: [
                    cartItem({
                        variant: {
                            ...cartItem().variant,
                            product: {
                                id: "p1",
                                name: "Smartphone",
                                slug: "smartphone",
                                status: ProductStatus.ARCHIVED,
                                isActive: false,
                                isDeleted: false,
                            },
                        },
                    }),
                ],
            }),
        );

        const view = await CartService.getCart(user);

        expect(view.items[0]?.variant?.isAvailable).toBe(false);
    });

    it("exposes stock as a read-only signal", async () => {
        mocks.cartFindUnique.mockResolvedValue(
            cart({
                items: [
                    cartItem({
                        variant: {
                            ...cartItem().variant,
                            inventory: { availableQuantity: 0 },
                        },
                    }),
                ],
            }),
        );

        const view = await CartService.getCart(user);

        expect(view.items[0]?.variant?.availableQuantity).toBe(0);
        expect(view.items[0]?.variant?.inStock).toBe(false);
    });
});

describe("CartService.addCartItem", () => {
    it("consolidates a repeated addition into the existing line", async () => {
        mocks.variantFindFirst.mockResolvedValue(activeVariant());
        mocks.cartUpsert.mockResolvedValue({ id: "cart1" });
        mocks.cartItemFindUnique.mockResolvedValue({ quantity: 1 });
        mocks.cartItemUpsert.mockResolvedValue({ id: "i1" });
        mocks.cartFindUnique.mockResolvedValue(null);

        await CartService.addCartItem(user, { variantId: "v1", quantity: 2 });

        expect(mocks.cartItemUpsert).toHaveBeenCalledWith({
            where: {
                uniq_cart_item_cart_variant: {
                    cartId: "cart1",
                    variantId: "v1",
                },
            },
            create: { cartId: "cart1", variantId: "v1", quantity: 2 },
            update: { quantity: 3 },
        });
    });

    it("creates the cart lazily for the authenticated user", async () => {
        mocks.variantFindFirst.mockResolvedValue(activeVariant());
        mocks.cartUpsert.mockResolvedValue({ id: "cart1" });
        mocks.cartItemFindUnique.mockResolvedValue(null);
        mocks.cartItemUpsert.mockResolvedValue({ id: "i1" });
        mocks.cartFindUnique.mockResolvedValue(null);

        await CartService.addCartItem(user, { variantId: "v1", quantity: 1 });

        expect(mocks.cartUpsert).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { userId: "u1" },
                create: { userId: "u1" },
            }),
        );
    });

    it("rejects an unknown variant", async () => {
        mocks.variantFindFirst.mockResolvedValue(null);

        await expect(
            CartService.addCartItem(user, { variantId: "v1", quantity: 1 }),
        ).rejects.toMatchObject({ statusCode: 404 });

        expect(mocks.cartItemUpsert).not.toHaveBeenCalled();
    });

    it.each([
        ["an inactive variant", { isActive: false }],
        [
            "a variant of a draft product",
            {
                product: {
                    id: "p1",
                    status: ProductStatus.DRAFT,
                    isActive: true,
                    isDeleted: false,
                },
            },
        ],
        [
            "a variant of an archived product",
            {
                product: {
                    id: "p1",
                    status: ProductStatus.ARCHIVED,
                    isActive: false,
                    isDeleted: false,
                },
            },
        ],
    ])("refuses to add %s", async (_label, overrides) => {
        mocks.variantFindFirst.mockResolvedValue(
            activeVariant(overrides as Record<string, unknown>),
        );

        await expect(
            CartService.addCartItem(user, { variantId: "v1", quantity: 1 }),
        ).rejects.toMatchObject({ statusCode: 400 });

        expect(mocks.cartItemUpsert).not.toHaveBeenCalled();
    });

    it("refuses to exceed the per-line cap", async () => {
        mocks.variantFindFirst.mockResolvedValue(activeVariant());
        mocks.cartUpsert.mockResolvedValue({ id: "cart1" });
        mocks.cartItemFindUnique.mockResolvedValue({ quantity: 99 });

        await expect(
            CartService.addCartItem(user, { variantId: "v1", quantity: 1 }),
        ).rejects.toMatchObject({ statusCode: 400 });

        expect(mocks.cartItemUpsert).not.toHaveBeenCalled();
    });

    it("never writes stock while adding to a cart", async () => {
        // The mocked Prisma client exposes no inventory delegate at all, so any
        // stock write attempted from the cart path would throw here. Carts never
        // reserve stock; the authoritative check happens at checkout.
        mocks.variantFindFirst.mockResolvedValue(activeVariant());
        mocks.cartUpsert.mockResolvedValue({ id: "cart1" });
        mocks.cartItemFindUnique.mockResolvedValue(null);
        mocks.cartItemUpsert.mockResolvedValue({ id: "i1" });
        mocks.cartFindUnique.mockResolvedValue(null);

        await expect(
            CartService.addCartItem(user, { variantId: "v1", quantity: 1 }),
        ).resolves.toMatchObject({ items: [] });

        expect(mocks.cartItemUpsert).toHaveBeenCalled();
    });
});

describe("CartService item ownership", () => {
    it("scopes the ownership lookup to the caller's own cart", async () => {
        mocks.cartFindUnique.mockResolvedValue({ id: "cart-of-u1" });
        mocks.cartItemFindFirst.mockResolvedValue(null);

        await expect(
            CartService.updateCartItemQuantity(user, "item-of-u2", {
                quantity: 2,
            }),
        ).rejects.toMatchObject({ statusCode: 404 });

        expect(mocks.cartItemFindFirst).toHaveBeenCalledWith({
            where: { id: "item-of-u2", cartId: "cart-of-u1" },
            select: { id: true },
        });
        expect(mocks.cartItemUpdate).not.toHaveBeenCalled();
    });

    it("updates a line the caller owns", async () => {
        mocks.cartFindUnique.mockResolvedValue({ id: "cart-of-u1" });
        mocks.cartItemFindFirst.mockResolvedValue({ id: "i1" });
        mocks.cartItemUpdate.mockResolvedValue({ id: "i1", quantity: 2 });

        await CartService.updateCartItemQuantity(user, "i1", { quantity: 2 });

        expect(mocks.cartItemUpdate).toHaveBeenCalledWith({
            where: { id: "i1" },
            data: { quantity: 2 },
        });
    });

    it("scopes the delete to the caller's cart in the same statement", async () => {
        mocks.cartFindUnique.mockResolvedValue({ id: "cart-of-u1" });
        mocks.cartItemDeleteMany.mockResolvedValue({ count: 1 });

        await CartService.removeCartItem(user, "i1");

        expect(mocks.cartItemDeleteMany).toHaveBeenCalledWith({
            where: { id: "i1", cartId: "cart-of-u1" },
        });
    });

    it("reports another user's line as missing and mutates nothing", async () => {
        mocks.cartFindUnique.mockResolvedValue({ id: "cart-of-u1" });
        mocks.cartItemDeleteMany.mockResolvedValue({ count: 0 });

        await expect(
            CartService.removeCartItem(user, "item-of-u2"),
        ).rejects.toMatchObject({ statusCode: 404 });
    });

    it("reports a miss when the caller has no cart at all", async () => {
        mocks.cartFindUnique.mockResolvedValue(null);

        await expect(
            CartService.removeCartItem(user, "i1"),
        ).rejects.toMatchObject({ statusCode: 404 });

        expect(mocks.cartItemDeleteMany).not.toHaveBeenCalled();
    });
});

describe("CartService.clearCart", () => {
    it("clears only the caller's cart", async () => {
        mocks.cartFindUnique
            .mockResolvedValueOnce({ id: "cart-of-u1" })
            .mockResolvedValueOnce(cart());
        mocks.cartItemDeleteMany.mockResolvedValue({ count: 2 });

        await CartService.clearCart(user);

        expect(mocks.cartItemDeleteMany).toHaveBeenCalledWith({
            where: { cartId: "cart-of-u1" },
        });
    });

    it("is a no-op for a user with no cart", async () => {
        mocks.cartFindUnique.mockResolvedValue(null);

        await expect(CartService.clearCart(user)).resolves.toMatchObject({
            items: [],
            subtotal: 0,
        });

        expect(mocks.cartItemDeleteMany).not.toHaveBeenCalled();
    });
});
