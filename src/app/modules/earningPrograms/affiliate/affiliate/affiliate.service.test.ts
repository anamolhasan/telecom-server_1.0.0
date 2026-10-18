import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    AffiliateApplicationStatus,
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
    affiliateAttributionFindUnique: vi.fn(),
    affiliateAttributionCreate: vi.fn(),
    affiliateAttributionCount: vi.fn(),
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
        },
        affiliateAttribution: {
            findUnique: mocks.affiliateAttributionFindUnique,
            create: mocks.affiliateAttributionCreate,
            count: mocks.affiliateAttributionCount,
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
