import status from "http-status";
import {
    AffiliateApplicationStatus,
    EarningProgram,
    EarningStatus,
} from "../../../../../generated/prisma/enums";
import AppError from "../../../../errorHelpers/AppError";
import type {
    IQueryParams,
    PrismaModelDelegate,
} from "../../../../interfaces/query.interface";
import type { IRequestUser } from "../../../../interfaces/requestUser.interface";
import { prisma } from "../../../../lib/prisma";
import { QueryBuilder } from "../../../../utils/QueryBuilder";
import { toMoneyNumber } from "../../../ecommerce/ecommerce.utils";
import { summariseEarningGroups } from "../../../earning/earning.service";
import {
    generateAffiliateLinkCode,
    isSelfAttribution,
} from "./affiliate.rule";
import type {
    IAffiliateConversionView,
    IAffiliateDashboard,
    IAffiliateLinkView,
    ICreateAffiliateLinkPayload,
    ITrackAffiliateVisitPayload,
    ITrackAffiliateVisitResult,
    IUpdateAffiliateLinkPayload,
} from "./affiliate.interface";

type AffiliateClient = typeof prisma;

const MAX_LINK_CODE_ATTEMPTS = 10;

// The caller's AppUser id. Affiliate membership hangs off AppUser, never off the
// account's system role.
const getAppUserForRequest = async (user: IRequestUser) => {
    const appUser = await prisma.appUser.findUnique({
        where: { authUserId: user.userId },
        select: { id: true },
    });

    if (!appUser) {
        throw new AppError(status.NOT_FOUND, "App user not found");
    }

    return appUser;
};

// Affiliate access derives from the persisted application row only.
const getAffiliateStatus = async (
    appUserId: string,
    client: AffiliateClient = prisma,
) => {
    const application = await client.affiliateApplication.findUnique({
        where: { appUserId },
        select: { status: true },
    });

    const approved = application?.status === AffiliateApplicationStatus.APPROVED;

    return { status: application?.status ?? null, approved };
};

const requireApprovedAffiliate = async (appUserId: string) => {
    const affiliate = await getAffiliateStatus(appUserId);

    if (!affiliate.approved) {
        throw new AppError(
            status.FORBIDDEN,
            "Forbidden access! An approved affiliate application is required.",
        );
    }

    return affiliate;
};

const toLinkView = (
    link: {
        id: string;
        code: string;
        productId: string | null;
        label: string | null;
        isActive: boolean;
        clickCount: number;
        createdAt: Date;
    },
    attributionCount: number,
): IAffiliateLinkView => ({
    id: link.id,
    code: link.code,
    productId: link.productId,
    label: link.label,
    // Links never expire. There is no expiry field to report, only the owner's
    // own on/off switch.
    isActive: link.isActive,
    clickCount: link.clickCount,
    attributionCount,
    createdAt: link.createdAt,
});

// Create a permanent affiliate link. The code never expires; it is only ever
// deactivated by its owner. Product binding is optional (a campaign link leaves
// the product to be supplied at visit time).
const createLink = async (
    user: IRequestUser,
    payload: ICreateAffiliateLinkPayload,
): Promise<IAffiliateLinkView> => {
    const appUser = await getAppUserForRequest(user);
    await requireApprovedAffiliate(appUser.id);

    if (payload.productId) {
        const product = await prisma.product.findUnique({
            where: { id: payload.productId },
            select: { id: true, isDeleted: true },
        });

        if (!product || product.isDeleted) {
            throw new AppError(status.BAD_REQUEST, "Product not found");
        }
    }

    for (let attempt = 0; attempt < MAX_LINK_CODE_ATTEMPTS; attempt++) {
        const code = generateAffiliateLinkCode();

        const taken = await prisma.affiliateLink.findUnique({
            where: { code },
            select: { id: true },
        });

        if (taken) {
            continue;
        }

        const created = await prisma.affiliateLink.create({
            data: {
                code,
                appUserId: appUser.id,
                productId: payload.productId ?? null,
                label: payload.label ?? null,
            },
        });

        return toLinkView(created, 0);
    }

    throw new AppError(
        status.INTERNAL_SERVER_ERROR,
        "Could not allocate a unique affiliate link code",
    );
};

// The caller's own links. Ownership is forced after the client filters, so a
// query string can never list another affiliate's links.
const getMyLinks = async (user: IRequestUser, query: IQueryParams) => {
    const appUser = await getAppUserForRequest(user);

    const result = await new QueryBuilder(
        prisma.affiliateLink as unknown as PrismaModelDelegate,
        query,
        {
            searchableFields: ["code", "label"],
            filterableFields: ["isActive", "productId", "createdAt"],
        },
    )
        .search()
        .filter()
        .where({ appUserId: appUser.id })
        .sort()
        .paginate()
        .fields()
        .execute();

    const links = result.data as unknown as Parameters<typeof toLinkView>[0][];
    const ids = links.map((link) => link.id);

    const counts = ids.length
        ? await prisma.affiliateAttribution.groupBy({
            by: ["affiliateLinkId"],
            where: { affiliateLinkId: { in: ids } },
            _count: { _all: true },
        })
        : [];

    const countByLink = new Map(
        counts.map((row) => [row.affiliateLinkId, row._count._all]),
    );

    return {
        ...result,
        data: links.map((link) =>
            toLinkView(link, countByLink.get(link.id) ?? 0),
        ),
    };
};

// Update the caller's own link. Both the ownership check and the allowed fields
// are server-side: an affiliate can never edit another affiliate's link, and can
// never change the code, the owner or the product binding.
const updateMyLink = async (
    user: IRequestUser,
    linkId: string,
    payload: IUpdateAffiliateLinkPayload,
): Promise<IAffiliateLinkView> => {
    const appUser = await getAppUserForRequest(user);

    const link = await prisma.affiliateLink.findUnique({ where: { id: linkId } });

    if (!link || link.appUserId !== appUser.id) {
        // Same response whether the link is missing or owned by someone else, so
        // the endpoint cannot be used to probe other affiliates' links.
        throw new AppError(status.NOT_FOUND, "Affiliate link not found");
    }

    const updated = await prisma.affiliateLink.update({
        where: { id: link.id },
        data: {
            ...(payload.label !== undefined ? { label: payload.label } : {}),
            ...(payload.isActive !== undefined ? { isActive: payload.isActive } : {}),
        },
    });

    const attributionCount = await prisma.affiliateAttribution.count({
        where: { affiliateLinkId: link.id },
    });

    return toLinkView(updated, attributionCount);
};

const refuseVisit = (reason: string, productId: string | null = null): ITrackAffiliateVisitResult => ({
    attributed: false,
    existing: false,
    reason,
    affiliateLinkId: null,
    productId,
    attributedAt: null,
});

// Record a visit and, when the customer+product pair has no attribution yet,
// establish the FIRST permanent attribution.
//
// The first valid attribution is final: an existing row is returned unchanged and
// is never silently replaced by this or any later visit, even from a different
// affiliate link. Attribution is only ever persisted when it is reliably
// establishable (an authenticated customer and a known product) — it is never
// guessed or invented.
const trackVisit = async (
    user: IRequestUser,
    payload: ITrackAffiliateVisitPayload,
): Promise<ITrackAffiliateVisitResult> => {
    const link = await prisma.affiliateLink.findUnique({
        where: { code: payload.code.trim().toUpperCase() },
        select: {
            id: true,
            appUserId: true,
            productId: true,
            isActive: true,
            appUser: { select: { authUserId: true } },
        },
    });

    if (!link) {
        return refuseVisit("UNKNOWN_LINK");
    }

    if (!link.isActive) {
        return refuseVisit("INACTIVE_LINK");
    }

    const productId = payload.productId ?? link.productId;

    if (!productId) {
        // Without a product the attribution could not be product-specific, so it
        // is not recorded at all rather than being spread across the catalogue.
        return refuseVisit("NO_PRODUCT_CONTEXT");
    }

    await prisma.affiliateLink.updateMany({
        where: { id: link.id },
        data: { clickCount: { increment: 1 } },
    });

    if (isSelfAttribution(link.appUser.authUserId, user.userId)) {
        return refuseVisit("SELF_ATTRIBUTION", productId);
    }

    const product = await prisma.product.findUnique({
        where: { id: productId },
        select: { id: true, isDeleted: true },
    });

    if (!product || product.isDeleted) {
        return refuseVisit("UNKNOWN_PRODUCT", productId);
    }

    const where = {
        uniq_affiliate_attribution_customer_product: {
            customerUserId: user.userId,
            productId,
        },
    };

    const existing = await prisma.affiliateAttribution.findUnique({ where });

    if (existing) {
        return {
            attributed: false,
            existing: true,
            reason: null,
            affiliateLinkId: existing.affiliateLinkId,
            productId,
            attributedAt: existing.firstSeenAt,
        };
    }

    try {
        const created = await prisma.affiliateAttribution.create({
            data: {
                customerUserId: user.userId,
                productId,
                affiliateLinkId: link.id,
                affiliateAppUserId: link.appUserId,
            },
        });

        return {
            attributed: true,
            existing: false,
            reason: null,
            affiliateLinkId: created.affiliateLinkId,
            productId,
            attributedAt: created.firstSeenAt,
        };
    } catch (error) {
        // A concurrent visit won the race. The first attribution stands and this
        // one is reported as already existing — never replaced.
        if (isUniqueConstraintError(error)) {
            const winner = await prisma.affiliateAttribution.findUnique({ where });

            return {
                attributed: false,
                existing: true,
                reason: null,
                affiliateLinkId: winner?.affiliateLinkId ?? link.id,
                productId,
                attributedAt: winner?.firstSeenAt ?? null,
            };
        }

        throw error;
    }
};

const isUniqueConstraintError = (error: unknown): boolean =>
    Boolean(
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: string }).code === "P2002",
    );

const toConversionView = (conversion: {
    id: string;
    productOrderId: string;
    productId: string;
    orderAmount: unknown;
    amount: unknown;
    currency: string;
    status: EarningStatus;
    convertedAt: Date;
    availableAt: Date | null;
    reversedAt: Date | null;
}): IAffiliateConversionView => ({
    id: conversion.id,
    productOrderId: conversion.productOrderId,
    productId: conversion.productId,
    orderAmount: toMoneyNumber(conversion.orderAmount),
    amount: toMoneyNumber(conversion.amount),
    currency: conversion.currency,
    status: conversion.status,
    convertedAt: conversion.convertedAt,
    availableAt: conversion.availableAt,
    reversedAt: conversion.reversedAt,
});

// The caller's own conversions. Ownership is forced after client filters.
const getMyConversions = async (user: IRequestUser, query: IQueryParams) => {
    const appUser = await getAppUserForRequest(user);

    const result = await new QueryBuilder(
        prisma.affiliateConversion as unknown as PrismaModelDelegate,
        query,
        {
            searchableFields: ["productOrderId"],
            filterableFields: ["status", "productId", "convertedAt"],
        },
    )
        .search()
        .filter()
        .where({ affiliateAppUserId: appUser.id })
        .sort()
        .paginate()
        .fields()
        .execute();

    return {
        ...result,
        data: (result.data as unknown as Parameters<typeof toConversionView>[0][]).map(
            toConversionView,
        ),
    };
};

// The Affiliate dashboard for the caller: own application state, own link stats,
// own attribution reach, own conversions and own earnings. Nothing about another
// affiliate is reachable and no commission configuration is returned.
const getAffiliateDashboard = async (
    user: IRequestUser,
): Promise<IAffiliateDashboard> => {
    const appUser = await prisma.appUser.findUnique({
        where: { authUserId: user.userId },
        select: {
            id: true,
            balance: true,
            totalEarned: true,
            affiliateApplication: {
                select: {
                    status: true,
                    appliedAt: true,
                    reviewedAt: true,
                    rejectionReason: true,
                },
            },
        },
    });

    if (!appUser) {
        throw new AppError(status.NOT_FOUND, "App user not found");
    }

    const [
        linkAggregate,
        attributionGroups,
        conversionAggregate,
        earningGroups,
    ] = await Promise.all([
        prisma.affiliateLink.aggregate({
            where: { appUserId: appUser.id },
            _count: { _all: true },
            _sum: { clickCount: true },
        }),
        prisma.affiliateAttribution.groupBy({
            by: ["customerUserId"],
            where: { affiliateAppUserId: appUser.id },
        }),
        prisma.affiliateConversion.aggregate({
            where: { affiliateAppUserId: appUser.id },
            _count: { _all: true },
            _sum: { orderAmount: true, amount: true },
        }),
        prisma.earningTransaction.groupBy({
            by: ["status"],
            where: { program: EarningProgram.AFFILIATE, appUserId: appUser.id },
            _sum: { amount: true },
        }),
    ]);

    const activeLinks = await prisma.affiliateLink.count({
        where: { appUserId: appUser.id, isActive: true },
    });

    return {
        program: "AFFILIATE",
        application: {
            status: appUser.affiliateApplication?.status ?? null,
            appliedAt: appUser.affiliateApplication?.appliedAt ?? null,
            reviewedAt: appUser.affiliateApplication?.reviewedAt ?? null,
            rejectionReason: appUser.affiliateApplication?.rejectionReason ?? null,
        },
        approved:
            appUser.affiliateApplication?.status ===
            AffiliateApplicationStatus.APPROVED,
        links: {
            total: linkAggregate._count._all,
            active: activeLinks,
            clicks: linkAggregate._sum.clickCount ?? 0,
        },
        attribution: {
            customersAttributed: attributionGroups.length,
        },
        conversions: {
            total: conversionAggregate._count._all,
            orderAmount: toMoneyNumber(conversionAggregate._sum.orderAmount),
            commission: toMoneyNumber(conversionAggregate._sum.amount),
        },
        earnings: summariseEarningGroups(earningGroups),
        wallet: {
            balance: toMoneyNumber(appUser.balance),
            totalEarned: toMoneyNumber(appUser.totalEarned),
        },
    };
};

export const AffiliateService = {
    getAffiliateStatus,
    createLink,
    getMyLinks,
    updateMyLink,
    trackVisit,
    getMyConversions,
    getAffiliateDashboard,
};
