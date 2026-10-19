import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    AffiliateApplicationStatus,
    EarningStatus,
    Role,
} from "../../../../../generated/prisma/enums";
import { AffiliateService } from "./affiliate.service";

const mocks = vi.hoisted(() => ({
    appUserFindUnique: vi.fn(),
    affiliateApplicationFindUnique: vi.fn(),
    affiliateLinkFindUnique: vi.fn(),
    affiliateLinkCreate: vi.fn(),
    affiliateLinkUpdate: vi.fn(),
    affiliateLinkUpdateMany: vi.fn(),
    affiliateLinkAggregate: vi.fn(),
    affiliateLinkCount: vi.fn(),
    affiliateAttributionFindUnique: vi.fn(),
    affiliateAttributionCreate: vi.fn(),
    affiliateAttributionCount: vi.fn(),
    affiliateAttributionGroupBy: vi.fn(),
    affiliateConversionAggregate: vi.fn(),
    earningTransactionGroupBy: vi.fn(),
    productFindUnique: vi.fn(),
}));

vi.mock("../../../../lib/prisma", () => ({
    prisma: {
        appUser: { findUnique: mocks.appUserFindUnique },
        affiliateApplication: { findUnique: mocks.affiliateApplicationFindUnique },
        affiliateLink: {
            findUnique: mocks.affiliateLinkFindUnique,
            create: mocks.affiliateLinkCreate,
            update: mocks.affiliateLinkUpdate,
            updateMany: mocks.affiliateLinkUpdateMany,
            aggregate: mocks.affiliateLinkAggregate,
            count: mocks.affiliateLinkCount,
        },
        affiliateAttribution: {
            findUnique: mocks.affiliateAttributionFindUnique,
            create: mocks.affiliateAttributionCreate,
            count: mocks.affiliateAttributionCount,
            groupBy: mocks.affiliateAttributionGroupBy,
        },
        affiliateConversion: {
            aggregate: mocks.affiliateConversionAggregate,
        },
        earningTransaction: {
            groupBy: mocks.earningTransactionGroupBy,
        },
        product: { findUnique: mocks.productFindUnique },
    },
}));

const requestUser = (role: Role = Role.USER) => ({
    userId: "auth-customer",
    role,
    email: "c@x.com",
});

const linkRow = (overrides: Record<string, unknown> = {}) => ({
    id: "link-1",
    code: "PERMANENT01",
    appUserId: "app-affiliate",
    productId: "p1",
    label: null,
    isActive: true,
    clickCount: 0,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    appUser: { authUserId: "auth-affiliate" },
    ...overrides,
});

beforeEach(() => {
    vi.resetAllMocks();
    mocks.appUserFindUnique.mockResolvedValue({ id: "app-affiliate" });
    mocks.affiliateApplicationFindUnique.mockResolvedValue({
        status: AffiliateApplicationStatus.APPROVED,
    });
    mocks.affiliateLinkUpdateMany.mockResolvedValue({ count: 1 });
    mocks.productFindUnique.mockResolvedValue({ id: "p1", isDeleted: false });
});

describe("AffiliateService.createLink", () => {
    it("refuses a link for an application that is not approved", async () => {
        mocks.affiliateApplicationFindUnique.mockResolvedValue({
            status: AffiliateApplicationStatus.PENDING,
        });

        await expect(
            AffiliateService.createLink(requestUser(Role.ADMIN), {}),
        ).rejects.toMatchObject({ statusCode: 403 });

        expect(mocks.affiliateLinkCreate).not.toHaveBeenCalled();
    });

    it("lets an approved affiliate of any system role create a permanent link", async () => {
        mocks.affiliateLinkFindUnique.mockResolvedValue(null);
        mocks.affiliateLinkCreate.mockResolvedValue(linkRow());

        const created = await AffiliateService.createLink(requestUser(Role.MODERATOR), {
            productId: "p1",
            label: "Campaign",
        });

        // The code is generated server-side; the client cannot choose or change it.
        expect(mocks.affiliateLinkCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    appUserId: "app-affiliate",
                    productId: "p1",
                    label: "Campaign",
                }),
            }),
        );
        expect(created.code).toBe("PERMANENT01");
        expect(created.isActive).toBe(true);
    });

    it("rejects a link bound to an unknown product", async () => {
        mocks.productFindUnique.mockResolvedValue(null);

        await expect(
            AffiliateService.createLink(requestUser(), { productId: "gone" }),
        ).rejects.toMatchObject({ statusCode: 400 });
    });
});

describe("AffiliateService.updateMyLink", () => {
    it("refuses to touch a link owned by another affiliate", async () => {
        mocks.affiliateLinkFindUnique.mockResolvedValue(
            linkRow({ appUserId: "someone-else" }),
        );

        await expect(
            AffiliateService.updateMyLink(requestUser(), "link-1", { isActive: false }),
        ).rejects.toMatchObject({ statusCode: 404 });

        expect(mocks.affiliateLinkUpdate).not.toHaveBeenCalled();
    });

    it("only ever changes the label and the owner's on/off switch", async () => {
        mocks.affiliateLinkFindUnique.mockResolvedValue(linkRow());
        mocks.affiliateLinkUpdate.mockResolvedValue(linkRow({ label: "New" }));
        mocks.affiliateAttributionCount.mockResolvedValue(3);

        const updated = await AffiliateService.updateMyLink(
            requestUser(),
            "link-1",
            { label: "New" },
        );

        expect(mocks.affiliateLinkUpdate).toHaveBeenCalledWith({
            where: { id: "link-1" },
            data: { label: "New" },
        });
        expect(updated.attributionCount).toBe(3);
        expect(updated.code).toBe("PERMANENT01");
    });
});

describe("AffiliateService.trackVisit", () => {
    it("establishes the FIRST permanent attribution", async () => {
        mocks.affiliateLinkFindUnique.mockResolvedValue(linkRow());
        mocks.affiliateAttributionFindUnique.mockResolvedValue(null);
        mocks.affiliateAttributionCreate.mockResolvedValue({
            affiliateLinkId: "link-1",
            firstSeenAt: new Date("2026-10-18"),
        });

        const result = await AffiliateService.trackVisit(requestUser(), {
            code: "permanent01",
            productId: "p1",
        });

        expect(result.attributed).toBe(true);
        expect(result.existing).toBe(false);
        expect(mocks.affiliateAttributionCreate).toHaveBeenCalledWith({
            data: {
                customerUserId: "auth-customer",
                productId: "p1",
                affiliateLinkId: "link-1",
                affiliateAppUserId: "app-affiliate",
            },
        });
        // Every visit is counted, including the ones that change nothing.
        expect(mocks.affiliateLinkUpdateMany).toHaveBeenCalledWith({
            where: { id: "link-1" },
            data: { clickCount: { increment: 1 } },
        });
    });

    it("keeps the first attribution when another affiliate's link is visited again", async () => {
        mocks.affiliateLinkFindUnique.mockResolvedValue(
            linkRow({ id: "link-2", appUserId: "other-affiliate" }),
        );
        // The first attribution belongs to link-1 and must survive.
        mocks.affiliateAttributionFindUnique.mockResolvedValue({
            affiliateLinkId: "link-1",
            firstSeenAt: new Date("2026-03-01"),
        });

        const result = await AffiliateService.trackVisit(requestUser(), {
            code: "PERMANENT01",
            productId: "p1",
        });

        expect(result.attributed).toBe(false);
        expect(result.existing).toBe(true);
        expect(result.affiliateLinkId).toBe("link-1");
        expect(result.attributedAt).toEqual(new Date("2026-03-01"));
        expect(mocks.affiliateAttributionCreate).not.toHaveBeenCalled();
    });

    it("keeps the first attribution when a concurrent visit won the race", async () => {
        mocks.affiliateLinkFindUnique.mockResolvedValue(linkRow());
        mocks.affiliateAttributionFindUnique
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({
                affiliateLinkId: "link-1",
                firstSeenAt: new Date("2026-10-18"),
            });
        mocks.affiliateAttributionCreate.mockRejectedValue(
            Object.assign(new Error("unique"), { code: "P2002" }),
        );

        const result = await AffiliateService.trackVisit(requestUser(), {
            code: "PERMANENT01",
            productId: "p1",
        });

        expect(result.attributed).toBe(false);
        expect(result.existing).toBe(true);
        expect(result.affiliateLinkId).toBe("link-1");
    });

    it("never attributes an affiliate to their own purchase", async () => {
        mocks.affiliateLinkFindUnique.mockResolvedValue(linkRow());
        mocks.appUserFindUnique.mockResolvedValue({ id: "app-affiliate" });

        const result = await AffiliateService.trackVisit(
            { userId: "auth-affiliate", role: Role.USER, email: "a@x.com" },
            { code: "PERMANENT01", productId: "p1" },
        );

        expect(result.attributed).toBe(false);
        expect(result.reason).toBe("SELF_ATTRIBUTION");
        expect(mocks.affiliateAttributionCreate).not.toHaveBeenCalled();
    });

    it("records nothing when the product cannot be established", async () => {
        mocks.affiliateLinkFindUnique.mockResolvedValue(
            linkRow({ productId: null }),
        );

        const result = await AffiliateService.trackVisit(requestUser(), {
            code: "PERMANENT01",
        });

        // No product => the attribution could not be product-specific => never
        // invented, and never spread across the customer's whole basket.
        expect(result.attributed).toBe(false);
        expect(result.reason).toBe("NO_PRODUCT_CONTEXT");
        expect(mocks.affiliateAttributionCreate).not.toHaveBeenCalled();
    });

    it("ignores an unknown link", async () => {
        mocks.affiliateLinkFindUnique.mockResolvedValue(null);

        const result = await AffiliateService.trackVisit(requestUser(), {
            code: "NOPE",
            productId: "p1",
        });

        expect(result.reason).toBe("UNKNOWN_LINK");
        expect(mocks.affiliateLinkUpdateMany).not.toHaveBeenCalled();
    });

    it("does not start new attributions from a deactivated link", async () => {
        mocks.affiliateLinkFindUnique.mockResolvedValue(
            linkRow({ isActive: false }),
        );

        const result = await AffiliateService.trackVisit(requestUser(), {
            code: "PERMANENT01",
            productId: "p1",
        });

        expect(result.reason).toBe("INACTIVE_LINK");
        expect(mocks.affiliateAttributionCreate).not.toHaveBeenCalled();
    });

    it("ignores a product that no longer exists", async () => {
        mocks.affiliateLinkFindUnique.mockResolvedValue(linkRow());
        mocks.productFindUnique.mockResolvedValue(null);

        const result = await AffiliateService.trackVisit(requestUser(), {
            code: "PERMANENT01",
            productId: "gone",
        });

        expect(result.reason).toBe("UNKNOWN_PRODUCT");
        expect(mocks.affiliateAttributionCreate).not.toHaveBeenCalled();
    });
});

// The Affiliate dashboard is readable by any authenticated account and always
// reports the caller's own state. "No application", "pending" and "rejected" are
// ordinary 200 responses (the frontend renders a message for each), and a missing
// account row is a clean 404 — never an unhandled 500.
describe("AffiliateService.getAffiliateDashboard", () => {
    const emptyAggregates = () => {
        mocks.affiliateLinkAggregate.mockResolvedValue({
            _count: { _all: 0 },
            _sum: { clickCount: null },
        });
        mocks.affiliateLinkCount.mockResolvedValue(0);
        mocks.affiliateAttributionGroupBy.mockResolvedValue([]);
        mocks.affiliateConversionAggregate.mockResolvedValue({
            _count: { _all: 0 },
            _sum: { orderAmount: null, amount: null },
        });
        mocks.earningTransactionGroupBy.mockResolvedValue([]);
    };

    beforeEach(() => {
        emptyAggregates();
        mocks.appUserFindUnique.mockResolvedValue({
            id: "app-affiliate",
            balance: 0,
            totalEarned: 0,
            affiliateApplication: null,
        });
    });

    it("reports the no-application state with zeroed figures", async () => {
        const dashboard = await AffiliateService.getAffiliateDashboard(requestUser());

        expect(dashboard.program).toBe("AFFILIATE");
        expect(dashboard.application.status).toBeNull();
        expect(dashboard.approved).toBe(false);
        expect(dashboard.links).toEqual({ total: 0, active: 0, clicks: 0 });
        expect(dashboard.earnings).toEqual({
            pending: 0,
            available: 0,
            reversed: 0,
        });
    });

    it("reports a pending application as not approved", async () => {
        mocks.appUserFindUnique.mockResolvedValue({
            id: "app-affiliate",
            balance: 0,
            totalEarned: 0,
            affiliateApplication: {
                status: AffiliateApplicationStatus.PENDING,
                appliedAt: new Date("2026-10-01"),
                reviewedAt: null,
                rejectionReason: null,
            },
        });

        const dashboard = await AffiliateService.getAffiliateDashboard(requestUser());

        expect(dashboard.application.status).toBe(AffiliateApplicationStatus.PENDING);
        expect(dashboard.approved).toBe(false);
    });

    it("reports a rejected application with the reason", async () => {
        mocks.appUserFindUnique.mockResolvedValue({
            id: "app-affiliate",
            balance: 0,
            totalEarned: 0,
            affiliateApplication: {
                status: AffiliateApplicationStatus.REJECTED,
                appliedAt: new Date("2026-10-01"),
                reviewedAt: new Date("2026-10-03"),
                rejectionReason: "Traffic quality",
            },
        });

        const dashboard = await AffiliateService.getAffiliateDashboard(requestUser());

        expect(dashboard.application.status).toBe(AffiliateApplicationStatus.REJECTED);
        expect(dashboard.application.rejectionReason).toBe("Traffic quality");
        expect(dashboard.approved).toBe(false);
    });

    it("reports the approved dashboard with the caller's own figures", async () => {
        mocks.appUserFindUnique.mockResolvedValue({
            id: "app-affiliate",
            balance: 150,
            totalEarned: 200,
            affiliateApplication: {
                status: AffiliateApplicationStatus.APPROVED,
                appliedAt: new Date("2026-09-01"),
                reviewedAt: new Date("2026-09-02"),
                rejectionReason: null,
            },
        });
        mocks.affiliateLinkAggregate.mockResolvedValue({
            _count: { _all: 2 },
            _sum: { clickCount: 12 },
        });
        mocks.affiliateLinkCount.mockResolvedValue(1);
        mocks.affiliateAttributionGroupBy.mockResolvedValue([
            { customerUserId: "c1" },
            { customerUserId: "c2" },
        ]);
        mocks.affiliateConversionAggregate.mockResolvedValue({
            _count: { _all: 3 },
            _sum: { orderAmount: 900, amount: 90 },
        });
        mocks.earningTransactionGroupBy.mockResolvedValue([
            { status: EarningStatus.AVAILABLE, _sum: { amount: 90 } },
        ]);

        const dashboard = await AffiliateService.getAffiliateDashboard(requestUser());

        expect(dashboard.approved).toBe(true);
        expect(dashboard.links).toEqual({ total: 2, active: 1, clicks: 12 });
        expect(dashboard.attribution).toEqual({ customersAttributed: 2 });
        expect(dashboard.conversions).toEqual({
            total: 3,
            orderAmount: 900,
            commission: 90,
        });
        expect(dashboard.wallet).toEqual({ balance: 150, totalEarned: 200 });
    });

    it("fails with a clean 404 (not a 500) when the account has no app user row", async () => {
        mocks.appUserFindUnique.mockResolvedValue(null);

        await expect(
            AffiliateService.getAffiliateDashboard(requestUser()),
        ).rejects.toMatchObject({ statusCode: 404 });
    });
});
