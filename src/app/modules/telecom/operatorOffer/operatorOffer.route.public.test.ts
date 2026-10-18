import {
    afterAll,
    afterEach,
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
import { Role, UserStatus } from "../../../../generated/prisma/enums";
import { envVars } from "../../../config/env";
import { jwtUtils } from "../../../utils/jwt";
import { OperatorOfferRoutes } from "./operatorOffer.route";

// The public GET endpoints run the real route -> checkAuthOptional -> controller
// -> public projection pipeline against a mocked Prisma session lookup and a
// mocked service, so the wiring itself is what is under test.
const mocks = vi.hoisted(() => ({
    sessionFindFirst: vi.fn(),
    getAllOperatorOffers: vi.fn(),
    getOperatorOfferById: vi.fn(),
}));

vi.mock("../../../lib/prisma", () => ({
    prisma: {
        session: { findFirst: mocks.sessionFindFirst },
    },
}));

vi.mock("./operatorOffer.service", () => ({
    OperatorOfferService: {
        getAllOperatorOffers: mocks.getAllOperatorOffers,
        getOperatorOfferById: mocks.getOperatorOfferById,
    },
}));

// Internal commercial fields that must never appear in a public response.
const SENSITIVE_FIELDS = [
    "companyPurchasePrice",
    "resellerCommissionType",
    "resellerCommissionValue",
    "agentCommissionType",
    "agentCommissionValue",
    "commissionRate",
    "referralCommissionRate",
] as const;

const storedOffer = (overrides: Record<string, unknown> = {}) => ({
    id: "offer-1",
    operatorId: "op-1",
    name: "10 GB Bundle",
    description: "A bundle",
    offerType: "MB",
    type: "INTERNET",
    amount: 10,
    amountUnit: "GB",
    validityValue: 30,
    validityUnit: "DAYS",
    regularPrice: 100,
    price: 80,
    discountType: "FIXED",
    discountValue: 20,
    companyPurchasePrice: 60,
    resellerCommissionType: "PERCENTAGE",
    resellerCommissionValue: 5,
    agentCommissionType: "FIXED",
    agentCommissionValue: 3,
    commissionRate: 5,
    referralCommissionRate: 2,
    inventoryMode: "UNLIMITED",
    stockQuantity: null,
    badges: ["NEW"],
    startsAt: new Date("2026-01-01T00:00:00.000Z"),
    endsAt: new Date("2026-02-01T00:00:00.000Z"),
    status: "ACTIVE",
    isActive: true,
    isDeleted: false,
    deletedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    operator: {
        id: "op-1",
        name: "Grameenphone",
        code: "GP",
        logo: null,
        isActive: true,
        isDeleted: false,
    },
    ...overrides,
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
    data: unknown;
    meta?: unknown;
}

const app = express();
app.use(cookieParser());
app.use("/operator-offers", OperatorOfferRoutes);

let server: Server;
let baseUrl: string;

const get = async (
    path: string,
    role?: Role,
): Promise<{ status: number; body: ApiBody }> => {
    const headers: Record<string, string> = {};

    if (role) {
        mocks.sessionFindFirst.mockResolvedValue(buildSession(role));
        headers.Cookie = buildCookieHeader(role);
    }

    const response = await fetch(`${baseUrl}/operator-offers${path}`, {
        headers,
    });

    return { status: response.status, body: (await response.json()) as ApiBody };
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

afterEach(() => {
    vi.clearAllMocks();
});

type RouteLayer = {
    route?: {
        path: string;
        methods: Record<string, boolean>;
        stack: Array<{ name: string }>;
    };
};

const getRegisteredGetHandlers = (path: string): string[] | undefined => {
    const layers = (OperatorOfferRoutes as unknown as { stack: RouteLayer[] })
        .stack;
    const layer = layers.find(
        (item) => item.route?.methods?.get && item.route.path === path,
    );

    return layer?.route?.stack.map((handler) => handler.name);
};

describe("Operator Offer public GET route wiring", () => {
    it.each(["/", "/:id"])(
        "mounts checkAuthOptional on GET %s",
        (path) => {
            expect(getRegisteredGetHandlers(path)).toContain(
                "checkAuthOptional",
            );
        },
    );

    it("does not guard the public GET endpoints with checkAuth", () => {
        for (const path of ["/", "/:id"]) {
            expect(getRegisteredGetHandlers(path)).not.toContain("checkAuth");
        }
    });
});

describe("GET /operator-offers", () => {
    beforeEach(() => {
        mocks.getAllOperatorOffers.mockResolvedValue({
            data: [storedOffer()],
            meta: { page: 1, limit: 10, totalPages: 1 },
        });
    });

    it("serves anonymous callers the public projection", async () => {
        const { status, body } = await get("/");
        const items = body.data as Array<Record<string, unknown>>;

        expect(status).toBe(200);
        expect(body.success).toBe(true);
        expect(mocks.sessionFindFirst).not.toHaveBeenCalled();
        for (const field of SENSITIVE_FIELDS) {
            expect(items[0]).not.toHaveProperty(field);
        }
        expect(items[0]).toMatchObject({
            id: "offer-1",
            name: "10 GB Bundle",
            regularPrice: 100,
            price: 80,
        });
        expect(body.meta).toEqual({ page: 1, limit: 10, totalPages: 1 });
    });

    it("serves an authenticated non-admin the same public projection", async () => {
        const { status, body } = await get("/", Role.USER);
        const items = body.data as Array<Record<string, unknown>>;

        expect(status).toBe(200);
        expect(mocks.sessionFindFirst).toHaveBeenCalledTimes(1);
        for (const field of SENSITIVE_FIELDS) {
            expect(items[0]).not.toHaveProperty(field);
        }
    });

    it("keeps the commercial fields for an authenticated content admin", async () => {
        const { status, body } = await get("/", Role.ADMIN);
        const items = body.data as Array<Record<string, unknown>>;

        expect(status).toBe(200);
        expect(mocks.sessionFindFirst).toHaveBeenCalledTimes(1);
        expect(items[0]).toHaveProperty("companyPurchasePrice", 60);
        expect(items[0]).toHaveProperty("resellerCommissionValue", 5);
        expect(items[0]).toHaveProperty("agentCommissionValue", 3);
        expect(items[0]).toHaveProperty("commissionRate", 5);
        expect(items[0]).toHaveProperty("referralCommissionRate", 2);
    });
});

describe("GET /operator-offers/:id", () => {
    beforeEach(() => {
        mocks.getOperatorOfferById.mockResolvedValue(storedOffer());
    });

    it("serves anonymous callers the public projection", async () => {
        const { status, body } = await get("/offer-1");
        const item = body.data as Record<string, unknown>;

        expect(status).toBe(200);
        expect(mocks.sessionFindFirst).not.toHaveBeenCalled();
        for (const field of SENSITIVE_FIELDS) {
            expect(item).not.toHaveProperty(field);
        }
        expect(item).toMatchObject({
            id: "offer-1",
            name: "10 GB Bundle",
            regularPrice: 100,
        });
        expect(item.operator).toEqual({
            id: "op-1",
            name: "Grameenphone",
            code: "GP",
            logo: null,
            isActive: true,
        });
    });

    it("serves an authenticated non-admin the same public projection", async () => {
        const { status, body } = await get("/offer-1", Role.MODERATOR);
        const item = body.data as Record<string, unknown>;

        expect(status).toBe(200);
        expect(mocks.sessionFindFirst).toHaveBeenCalledTimes(1);
        for (const field of SENSITIVE_FIELDS) {
            expect(item).not.toHaveProperty(field);
        }
    });

    it("keeps the commercial fields for an authenticated content admin", async () => {
        const { status, body } = await get("/offer-1", Role.SUPER_ADMIN);
        const item = body.data as Record<string, unknown>;

        expect(status).toBe(200);
        expect(mocks.sessionFindFirst).toHaveBeenCalledTimes(1);
        expect(item).toHaveProperty("companyPurchasePrice", 60);
        expect(item).toHaveProperty("commissionRate", 5);
        expect(item).toHaveProperty("referralCommissionRate", 2);
    });
});
