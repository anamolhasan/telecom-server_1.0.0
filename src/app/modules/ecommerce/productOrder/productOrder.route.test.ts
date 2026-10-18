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
    ProductOrderStatus,
    ProductPaymentStatus,
    Role,
    UserStatus,
} from "../../../../generated/prisma/enums";
import { envVars } from "../../../config/env";
import { ORDER_STAFF_ROLES } from "../../../constants/rbac.constant";
import AppError from "../../../errorHelpers/AppError";
import { globalErrorHandler } from "../../../middleware/globalErrorHandler";
import { jwtUtils } from "../../../utils/jwt";
import { IndexRouters } from "../../../routes";

// The real route -> middleware -> controller pipeline is exercised against a
// mocked session lookup and a mocked service boundary, so what is under test is
// the HTTP contract: paths, guards, validation and response shape.
const mocks = vi.hoisted(() => ({
    sessionFindFirst: vi.fn(),
    checkout: vi.fn(),
    getMyOrders: vi.fn(),
    getMyOrder: vi.fn(),
    getAllProductOrders: vi.fn(),
    getProductOrderById: vi.fn(),
    updateOrderStatus: vi.fn(),
    updateOrderPayment: vi.fn(),
}));

vi.mock("../../../lib/prisma", () => ({
    prisma: {
        session: { findFirst: mocks.sessionFindFirst },
    },
}));

vi.mock("./productOrder.service", () => ({
    ProductOrderService: {
        checkout: mocks.checkout,
        getMyOrders: mocks.getMyOrders,
        getMyOrder: mocks.getMyOrder,
        getAllProductOrders: mocks.getAllProductOrders,
        getProductOrderById: mocks.getProductOrderById,
        updateOrderStatus: mocks.updateOrderStatus,
        updateOrderPayment: mocks.updateOrderPayment,
    },
}));

const emptyPage = () => ({
    data: [],
    meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
});

const orderView = () => ({
    id: "o1",
    orderNumber: "RZQ-20261018-000001",
    status: ProductOrderStatus.PENDING,
    paymentMethod: "COD",
    paymentStatus: ProductPaymentStatus.UNPAID,
    paidAt: null,
    subtotal: 10.1,
    discountAmount: 0,
    shippingAmount: 0,
    grandTotal: 10.1,
    currency: "bdt",
    shippingAddress: {
        recipientName: "Karim Ahmed",
        phone: "+8801712345678",
        division: "Dhaka",
        district: "Dhaka",
        upazila: null,
        unionArea: null,
        villageRoad: null,
        postalCode: null,
    },
    customerNote: null,
    items: [],
    createdAt: new Date("2026-10-18T00:00:00.000Z"),
    updatedAt: new Date("2026-10-18T00:00:00.000Z"),
});

const validCheckoutBody = {
    idempotencyKey: "checkout-attempt-0001",
    addressId: "addr-1",
};

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
    mocks.checkout.mockResolvedValue({ order: orderView(), idempotent: false });
    mocks.getMyOrders.mockResolvedValue(emptyPage());
    mocks.getMyOrder.mockResolvedValue(orderView());
    mocks.getAllProductOrders.mockResolvedValue(emptyPage());
    mocks.getProductOrderById.mockResolvedValue(orderView());
    mocks.updateOrderStatus.mockResolvedValue(orderView());
    mocks.updateOrderPayment.mockResolvedValue(orderView());
});

describe("checkout access", () => {
    it("rejects an anonymous checkout", async () => {
        const { status } = await request("POST", "/product-orders/checkout", {
            body: validCheckoutBody,
        });

        expect(status).toBe(401);
        expect(mocks.checkout).not.toHaveBeenCalled();
    });

    it("lets an authenticated customer place an order", async () => {
        const { status, body } = await request("POST", "/product-orders/checkout", {
            role: Role.USER,
            body: validCheckoutBody,
        });

        expect(status).toBe(201);
        expect(body.success).toBe(true);
        expect(body.message).toBe("Order placed successfully");

        // The buyer is taken from the session, never from the payload.
        expect(mocks.checkout).toHaveBeenCalledWith(
            expect.objectContaining({ userId: "u-1", role: Role.USER }),
            { idempotencyKey: "checkout-attempt-0001", addressId: "addr-1" },
        );
    });

    it("answers a replayed checkout with 200 and the same order", async () => {
        mocks.checkout.mockResolvedValue({ order: orderView(), idempotent: true });

        const { status, body } = await request("POST", "/product-orders/checkout", {
            role: Role.USER,
            body: validCheckoutBody,
        });

        expect(status).toBe(200);
        expect(body.message).toBe("Order was already placed");
        expect(body.data).toMatchObject({ id: "o1" });
    });

    it("requires an idempotency key before reaching the service", async () => {
        const { status } = await request("POST", "/product-orders/checkout", {
            role: Role.USER,
            body: { addressId: "addr-1" },
        });

        expect(status).toBe(400);
        expect(mocks.checkout).not.toHaveBeenCalled();
    });

    it("rejects an ambiguous request that supplies two address sources", async () => {
        const { status } = await request("POST", "/product-orders/checkout", {
            role: Role.USER,
            body: {
                ...validCheckoutBody,
                shippingAddress: {
                    recipientName: "Karim",
                    phone: "01712345678",
                    division: "Dhaka",
                    district: "Dhaka",
                },
            },
        });

        expect(status).toBe(400);
        expect(mocks.checkout).not.toHaveBeenCalled();
    });

    it("surfaces insufficient stock as a 409 without creating an order", async () => {
        mocks.checkout.mockRejectedValue(
            new AppError(409, "Insufficient stock for SKU-1"),
        );

        const { status, body } = await request("POST", "/product-orders/checkout", {
            role: Role.USER,
            body: validCheckoutBody,
        });

        expect(status).toBe(409);
        expect(body.success).toBe(false);
    });

    it("strips client-supplied prices, totals and statuses from the payload", async () => {
        await request("POST", "/product-orders/checkout", {
            role: Role.USER,
            body: {
                ...validCheckoutBody,
                grandTotal: 0.01,
                subtotal: 0.01,
                paymentStatus: "PAID",
                status: "DELIVERED",
                availableQuantity: 9999,
            },
        });

        expect(mocks.checkout).toHaveBeenCalledWith(expect.anything(), {
            idempotencyKey: "checkout-attempt-0001",
            addressId: "addr-1",
        });
    });
});

describe("customer order reads", () => {
    it.each([
        ["GET", "/product-orders/my"],
        ["GET", "/product-orders/my/o1"],
    ])("requires authentication for %s %s", async (method, path) => {
        const { status } = await request(method, path);

        expect(status).toBe(401);
        expect(mocks.getMyOrders).not.toHaveBeenCalled();
        expect(mocks.getMyOrder).not.toHaveBeenCalled();
    });

    it("serves the caller's own order list", async () => {
        const { status, body } = await request("GET", "/product-orders/my", {
            role: Role.USER,
        });

        expect(status).toBe(200);
        expect(body.success).toBe(true);
        expect(mocks.getMyOrders).toHaveBeenCalledWith(
            expect.objectContaining({ userId: "u-1" }),
            expect.anything(),
        );
    });

    it("serves a single order through the caller's own scope", async () => {
        const { status } = await request("GET", "/product-orders/my/o1", {
            role: Role.USER,
        });

        expect(status).toBe(200);
        expect(mocks.getMyOrder).toHaveBeenCalledWith(
            expect.objectContaining({ userId: "u-1" }),
            "o1",
        );
    });

    it("resolves the literal /my path before the staff /:id route", async () => {
        // If "/:id" had been declared first, "my" would have been read as an
        // order id and this staff caller would have hit the wrong handler.
        const { status } = await request("GET", "/product-orders/my", {
            role: Role.ADMIN,
        });

        expect(status).toBe(200);
        expect(mocks.getMyOrders).toHaveBeenCalled();
        expect(mocks.getProductOrderById).not.toHaveBeenCalled();
    });
});

describe("staff order operations", () => {
    const adminOnly: [string, string, unknown][] = [
        ["GET", "/product-orders", undefined],
        ["GET", "/product-orders/o1", undefined],
        ["PATCH", "/product-orders/o1/status", { status: "CONFIRMED" }],
        ["PATCH", "/product-orders/o1/payment", { paymentStatus: "PAID" }],
    ];

    it.each(adminOnly)("rejects an anonymous %s %s", async (method, path, body) => {
        const { status } = await request(method, path, { body });

        expect(status).toBe(401);
    });

    it.each(adminOnly)("rejects a customer's %s %s", async (method, path, body) => {
        const { status } = await request(method, path, { role: Role.USER, body });

        expect(status).toBe(403);
        expect(mocks.getAllProductOrders).not.toHaveBeenCalled();
        expect(mocks.getProductOrderById).not.toHaveBeenCalled();
        expect(mocks.updateOrderStatus).not.toHaveBeenCalled();
        expect(mocks.updateOrderPayment).not.toHaveBeenCalled();
    });

    it("keeps no customer-only gap in the staff role set", () => {
        // The staff guard reuses the existing order-staff roles; a customer can
        // never be part of it.
        expect(ORDER_STAFF_ROLES).not.toContain(Role.USER);
        expect(ORDER_STAFF_ROLES.length).toBeGreaterThan(0);
    });

    it.each(ORDER_STAFF_ROLES)("lets a %s list product orders", async (role) => {
        const { status, body } = await request("GET", "/product-orders", { role });

        expect(status).toBe(200);
        expect(body.success).toBe(true);
        expect(mocks.getAllProductOrders).toHaveBeenCalledTimes(1);
    });

    it.each(ORDER_STAFF_ROLES)(
        "lets a %s advance a fulfilment status",
        async (role) => {
            mocks.updateOrderStatus.mockResolvedValue(
                orderView() as never,
            );

            const { status } = await request(
                "PATCH",
                "/product-orders/o1/status",
                { role, body: { status: "CONFIRMED" } },
            );

            expect(status).toBe(200);
            expect(mocks.updateOrderStatus).toHaveBeenCalledWith(
                "o1",
                ProductOrderStatus.CONFIRMED,
            );
        },
    );

    it("rejects an unknown status value before it reaches the service", async () => {
        const { status } = await request("PATCH", "/product-orders/o1/status", {
            role: Role.ADMIN,
            body: { status: "REFUNDED" },
        });

        expect(status).toBe(400);
        expect(mocks.updateOrderStatus).not.toHaveBeenCalled();
    });

    it("records cash collection through a dedicated payment endpoint", async () => {
        const { status } = await request("PATCH", "/product-orders/o1/payment", {
            role: Role.ADMIN,
            body: { paymentStatus: "PAID" },
        });

        expect(status).toBe(200);
        expect(mocks.updateOrderPayment).toHaveBeenCalledWith(
            "o1",
            ProductPaymentStatus.PAID,
        );
    });

    it("rejects a fulfilment update that smuggles a payment status", async () => {
        await request("PATCH", "/product-orders/o1/status", {
            role: Role.ADMIN,
            body: { status: "CONFIRMED", paymentStatus: "PAID" },
        });

        expect(mocks.updateOrderStatus).toHaveBeenCalledWith(
            "o1",
            ProductOrderStatus.CONFIRMED,
        );
        expect(mocks.updateOrderPayment).not.toHaveBeenCalled();
    });

    it("propagates a service authorization failure as its own status code", async () => {
        mocks.updateOrderStatus.mockRejectedValue(
            new AppError(400, "Cannot change order status"),
        );

        const { status } = await request("PATCH", "/product-orders/o1/status", {
            role: Role.ADMIN,
            body: { status: "SHIPPED" },
        });

        expect(status).toBe(400);
    });
});
