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
import { Role, UserStatus } from "../../../generated/prisma/enums";
import { envVars } from "../../config/env";
import { ALL_ROLES, can } from "../../constants/rbac.constant";
import { globalErrorHandler } from "../../middleware/globalErrorHandler";
import { jwtUtils } from "../../utils/jwt";
import { IndexRouters } from "../../routes";
import { canManageCatalog } from "./catalog.access";

// The real route -> middleware -> controller pipeline is exercised against a
// mocked Prisma session lookup and mocked services, so what is under test is the
// authorization wiring: which roles reach which handler.
const mocks = vi.hoisted(() => ({
    sessionFindFirst: vi.fn(),
    getAllCategories: vi.fn(),
    getAllBrands: vi.fn(),
    getAllProducts: vi.fn(),
    getAllProductVariants: vi.fn(),
    createCategory: vi.fn(),
    createBrand: vi.fn(),
    createProduct: vi.fn(),
    updateProduct: vi.fn(),
    createProductVariant: vi.fn(),
    setInventory: vi.fn(),
    adjustInventory: vi.fn(),
    getCart: vi.fn(),
    addCartItem: vi.fn(),
    updateCartItemQuantity: vi.fn(),
    removeCartItem: vi.fn(),
    clearCart: vi.fn(),
}));

vi.mock("../../lib/prisma", () => ({
    prisma: {
        session: { findFirst: mocks.sessionFindFirst },
    },
}));

// Only the service boundary is mocked; the routes, guards, validators and
// projections stay real.
vi.mock("./category/category.service", () => ({
    CategoryService: {
        getAllCategories: mocks.getAllCategories,
        createCategory: mocks.createCategory,
    },
}));
vi.mock("./brand/brand.service", () => ({
    BrandService: {
        getAllBrands: mocks.getAllBrands,
        createBrand: mocks.createBrand,
    },
}));
vi.mock("./product/product.service", () => ({
    ProductService: {
        getAllProducts: mocks.getAllProducts,
        createProduct: mocks.createProduct,
        updateProduct: mocks.updateProduct,
    },
}));
vi.mock("./productVariant/productVariant.service", () => ({
    ProductVariantService: {
        getAllProductVariants: mocks.getAllProductVariants,
        createProductVariant: mocks.createProductVariant,
    },
}));
vi.mock("./inventory/inventory.service", () => ({
    InventoryService: {
        setInventory: mocks.setInventory,
        adjustInventory: mocks.adjustInventory,
    },
}));
vi.mock("./cart/cart.service", () => ({
    CartService: {
        getCart: mocks.getCart,
        addCartItem: mocks.addCartItem,
        updateCartItemQuantity: mocks.updateCartItemQuantity,
        removeCartItem: mocks.removeCartItem,
        clearCart: mocks.clearCart,
    },
}));

const emptyPage = () => ({
    data: [],
    meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
});

const emptyCart = () => ({
    id: null,
    userId: "u-1",
    items: [],
    itemCount: 0,
    unitCount: 0,
    subtotal: 0,
    createdAt: null,
    updatedAt: null,
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

// The aggregator is mounted as the application would mount it, so the route
// registration itself (paths + guards) is part of what is verified. The real
// global error handler is used so status codes (401/403/400) are the ones the
// API actually returns.
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
    options: { role?: Role; body?: unknown } = {},
): Promise<{ status: number; body: ApiBody }> => {
    const headers: Record<string, string> = {};

    if (options.body !== undefined) {
        headers["Content-Type"] = "application/json";
    }

    if (options.role) {
        mocks.sessionFindFirst.mockResolvedValue(buildSession(options.role));
        headers.Cookie = buildCookieHeader(options.role);
    }

    const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body:
            options.body === undefined
                ? undefined
                : JSON.stringify(options.body),
    });

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
    mocks.getAllCategories.mockResolvedValue(emptyPage());
    mocks.getAllBrands.mockResolvedValue(emptyPage());
    mocks.getAllProducts.mockResolvedValue(emptyPage());
    mocks.getAllProductVariants.mockResolvedValue(emptyPage());
    mocks.getCart.mockResolvedValue(emptyCart());
    mocks.updateCartItemQuantity.mockResolvedValue(emptyCart());
    mocks.removeCartItem.mockResolvedValue(emptyCart());
    mocks.clearCart.mockResolvedValue(emptyCart());
});

describe("catalog management rights", () => {
    it.each(ALL_ROLES)(
        "aligns the catalog guard for %s with the role-access policy",
        (role) => {
            // The routes use checkAuth(...CONTENT_ADMIN_ROLES). This asserts that
            // the same set is exactly the set the Role Access policy grants
            // "offers.manage" (the catalog management permission) to - i.e. no
            // new role or permission was invented for the e-commerce catalog.
            expect(canManageCatalog(role)).toBe(can(role, "offers.manage"));
        },
    );
});

describe("public catalog reads", () => {
    it.each([
        "/categories",
        "/brands",
        "/products",
        "/product-variants",
    ])("serves %s to an anonymous caller", async (path) => {
        const { status, body } = await request("GET", path);

        expect(status).toBe(200);
        expect(body.success).toBe(true);
        expect(mocks.sessionFindFirst).not.toHaveBeenCalled();
        expect(body.data).toEqual([]);
    });

    it("serves the catalog to a signed-in customer", async () => {
        const { status } = await request("GET", "/products", {
            role: Role.USER,
        });

        expect(status).toBe(200);
        expect(mocks.sessionFindFirst).toHaveBeenCalledTimes(1);
    });
});

describe("catalog writes require authentication", () => {
    it.each([
        ["POST", "/categories", { name: "SIM", slug: "sim" }],
        ["POST", "/brands", { name: "Samsung", slug: "samsung" }],
        [
            "POST",
            "/products",
            {
                name: "Phone",
                slug: "phone",
                description: "A phone",
                categoryId: "cat1",
            },
        ],
        ["POST", "/product-variants", { productId: "p1", sku: "SKU-1", price: 10 }],
        ["PUT", "/inventory/v1", { availableQuantity: 5 }],
        ["POST", "/inventory/v1/adjust", { delta: -1 }],
    ])("rejects an anonymous %s %s", async (method, path, body) => {
        const response = await request(method, path, { body });

        expect(response.status).toBe(401);
    });

    it("does not reach any service on an anonymous write", async () => {
        await request("POST", "/products", {
            body: {
                name: "Phone",
                slug: "phone",
                description: "A phone",
                categoryId: "cat1",
            },
        });

        expect(mocks.createProduct).not.toHaveBeenCalled();
    });
});

describe("catalog writes are forbidden to non-content-admin roles", () => {
    it.each([
        ["POST", "/categories", { name: "SIM", slug: "sim" }],
        ["POST", "/brands", { name: "Samsung", slug: "samsung" }],
        [
            "POST",
            "/products",
            {
                name: "Phone",
                slug: "phone",
                description: "A phone",
                categoryId: "cat1",
            },
        ],
        ["POST", "/product-variants", { productId: "p1", sku: "SKU-1", price: 10 }],
        ["PUT", "/inventory/v1", { availableQuantity: 5 }],
        ["POST", "/inventory/v1/adjust", { delta: -1 }],
    ])("rejects a customer's %s %s", async (method, path, body) => {
        const response = await request(method, path, {
            role: Role.USER,
            body,
        });

        expect(response.status).toBe(403);
        expect(mocks.createCategory).not.toHaveBeenCalled();
        expect(mocks.createBrand).not.toHaveBeenCalled();
        expect(mocks.createProduct).not.toHaveBeenCalled();
        expect(mocks.createProductVariant).not.toHaveBeenCalled();
        expect(mocks.setInventory).not.toHaveBeenCalled();
        expect(mocks.adjustInventory).not.toHaveBeenCalled();
    });

    it.each([Role.MODERATOR, Role.SUPPORTER, Role.EMPLOYEE])(
        "rejects a %s catalog write",
        async (role) => {
            const response = await request("POST", "/categories", {
                role,
                body: { name: "SIM", slug: "sim" },
            });

            expect(response.status).toBe(403);
            expect(mocks.createCategory).not.toHaveBeenCalled();
        },
    );

    it("rejects a customer's catalog update", async () => {
        const response = await request("PATCH", "/products/p1", {
            role: Role.USER,
            body: { name: "Renamed" },
        });

        expect(response.status).toBe(403);
        expect(mocks.updateProduct).not.toHaveBeenCalled();
    });
});

describe("catalog writes are allowed for content admins", () => {
    it.each([Role.SUPER_ADMIN, Role.ADMIN])(
        "lets a %s create a category",
        async (role) => {
            mocks.createCategory.mockResolvedValue({ id: "c1" });

            const { status, body } = await request("POST", "/categories", {
                role,
                body: { name: "SIM", slug: "sim" },
            });

            expect(status).toBe(201);
            expect(body.success).toBe(true);
            expect(mocks.createCategory).toHaveBeenCalledWith({
                name: "SIM",
                slug: "sim",
            });
        },
    );

    it("lets an admin create a product with a validated body", async () => {
        mocks.createProduct.mockResolvedValue({ id: "p1" });

        const { status } = await request("POST", "/products", {
            role: Role.ADMIN,
            body: {
                name: "Phone",
                slug: "phone",
                description: "A phone",
                categoryId: "cat1",
            },
        });

        expect(status).toBe(201);
        expect(mocks.createProduct).toHaveBeenCalledWith(
            expect.objectContaining({
                name: "Phone",
                slug: "phone",
                categoryId: "cat1",
            }),
        );
    });

    it("lets an admin update a product", async () => {
        mocks.updateProduct.mockResolvedValue({ id: "p1" });

        const { status } = await request("PATCH", "/products/p1", {
            role: Role.ADMIN,
            body: { name: "Renamed" },
        });

        expect(status).toBe(200);
        expect(mocks.updateProduct).toHaveBeenCalledWith("p1", {
            name: "Renamed",
        });
    });

    it("lets an admin set inventory", async () => {
        mocks.setInventory.mockResolvedValue({ variantId: "v1" });

        const { status } = await request("PUT", "/inventory/v1", {
            role: Role.ADMIN,
            body: { availableQuantity: 5, lowStockThreshold: 2 },
        });

        expect(status).toBe(200);
        expect(mocks.setInventory).toHaveBeenCalledWith("v1", {
            availableQuantity: 5,
            lowStockThreshold: 2,
        });
    });

    it("rejects an invalid stock value with a 400 before it reaches the service", async () => {
        const { status } = await request("PUT", "/inventory/v1", {
            role: Role.ADMIN,
            body: { availableQuantity: -5 },
        });

        expect(status).toBe(400);
        expect(mocks.setInventory).not.toHaveBeenCalled();
    });
});

describe("cart access", () => {
    it.each([
        ["GET", "/cart", undefined],
        ["POST", "/cart/items", { variantId: "v1" }],
        ["PATCH", "/cart/items/i1", { quantity: 2 }],
        ["DELETE", "/cart/items/i1", undefined],
        ["DELETE", "/cart", undefined],
    ])("requires authentication for %s %s", async (method, path, body) => {
        const { status } = await request(method as string, path as string, {
            body,
        });

        expect(status).toBe(401);
        expect(mocks.getCart).not.toHaveBeenCalled();
        expect(mocks.addCartItem).not.toHaveBeenCalled();
        expect(mocks.updateCartItemQuantity).not.toHaveBeenCalled();
        expect(mocks.removeCartItem).not.toHaveBeenCalled();
        expect(mocks.clearCart).not.toHaveBeenCalled();
    });

    it("serves a customer their own cart", async () => {
        const { status, body } = await request("GET", "/cart", {
            role: Role.USER,
        });

        expect(status).toBe(200);
        expect(body.success).toBe(true);
        // The cart is derived from the session, never from a request parameter.
        expect(mocks.getCart).toHaveBeenCalledWith(
            expect.objectContaining({ userId: "u-1", role: Role.USER }),
        );
    });

    it("adds an item for the authenticated user with a defaulted quantity", async () => {
        mocks.addCartItem.mockResolvedValue(emptyCart());

        const { status } = await request("POST", "/cart/items", {
            role: Role.USER,
            body: { variantId: "v1" },
        });

        expect(status).toBe(200);
        expect(mocks.addCartItem).toHaveBeenCalledWith(
            expect.objectContaining({ userId: "u-1" }),
            { variantId: "v1", quantity: 1 },
        );
    });

    it("rejects a negative quantity at the validation boundary", async () => {
        const { status } = await request("POST", "/cart/items", {
            role: Role.USER,
            body: { variantId: "v1", quantity: -3 },
        });

        expect(status).toBe(400);
        expect(mocks.addCartItem).not.toHaveBeenCalled();
    });

    it("rejects a client-supplied stock value on the cart payload", async () => {
        mocks.addCartItem.mockResolvedValue(emptyCart());

        await request("POST", "/cart/items", {
            role: Role.USER,
            body: { variantId: "v1", quantity: 1, availableQuantity: 9999 },
        });

        // Zod strips the unknown key, so no stock value can travel with a cart
        // write.
        expect(mocks.addCartItem).toHaveBeenCalledWith(
            expect.objectContaining({ userId: "u-1" }),
            { variantId: "v1", quantity: 1 },
        );
    });

    it("updates a line through the caller's own cart", async () => {
        const { status } = await request("PATCH", "/cart/items/i1", {
            role: Role.USER,
            body: { quantity: 2 },
        });

        expect(status).toBe(200);
        // The item id comes from the URL, but the cart is only ever the caller's,
        // so another user's line resolves to "not found" inside the service.
        expect(mocks.updateCartItemQuantity).toHaveBeenCalledWith(
            expect.objectContaining({ userId: "u-1" }),
            "i1",
            { quantity: 2 },
        );
    });

    it("rejects an out-of-range quantity at the validation boundary", async () => {
        const { status } = await request("PATCH", "/cart/items/i1", {
            role: Role.USER,
            body: { quantity: 0 },
        });

        expect(status).toBe(400);
        expect(mocks.updateCartItemQuantity).not.toHaveBeenCalled();
    });

    it("removes a line through the caller's own cart", async () => {
        const { status } = await request("DELETE", "/cart/items/i1", {
            role: Role.USER,
        });

        expect(status).toBe(200);
        expect(mocks.removeCartItem).toHaveBeenCalledWith(
            expect.objectContaining({ userId: "u-1" }),
            "i1",
        );
    });

    it("clears only the caller's cart", async () => {
        const { status } = await request("DELETE", "/cart", {
            role: Role.USER,
        });

        expect(status).toBe(200);
        expect(mocks.clearCart).toHaveBeenCalledWith(
            expect.objectContaining({ userId: "u-1" }),
        );
    });
});
