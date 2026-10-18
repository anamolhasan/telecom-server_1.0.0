import type {
    AffiliateApplicationStatus,
    EarningStatus,
} from "../../../../../generated/prisma/enums";

// Public shape of an affiliate link. The owner is implied by the session, and the
// link never exposes the affiliate's internal ids or any commission config.
export interface IAffiliateLinkView {
    id: string;
    code: string;
    productId: string | null;
    label: string | null;
    isActive: boolean;
    clickCount: number;
    attributionCount: number;
    createdAt: Date;
}

export interface ICreateAffiliateLinkPayload {
    productId?: string | null;
    label?: string | null;
}

export interface IUpdateAffiliateLinkPayload {
    label?: string | null;
    isActive?: boolean;
}

export interface ITrackAffiliateVisitPayload {
    code: string;
    productId?: string | null;
}

// Result of a visit. `attributed` is true only when a NEW permanent attribution
// was created; `existing` is true when the first attribution already existed and
// was deliberately kept unchanged. `reason` explains a refusal.
export interface ITrackAffiliateVisitResult {
    attributed: boolean;
    existing: boolean;
    reason: string | null;
    affiliateLinkId: string | null;
    productId: string | null;
    attributedAt: Date | null;
}

export interface IAffiliateConversionView {
    id: string;
    productOrderId: string;
    productId: string;
    orderAmount: number;
    amount: number;
    currency: string;
    status: EarningStatus;
    convertedAt: Date;
    availableAt: Date | null;
    reversedAt: Date | null;
}

export interface IAffiliateDashboard {
    program: "AFFILIATE";
    application: {
        status: AffiliateApplicationStatus | null;
        appliedAt: Date | null;
        reviewedAt: Date | null;
        rejectionReason: string | null;
    };
    approved: boolean;
    links: {
        total: number;
        active: number;
        clicks: number;
    };
    attribution: {
        customersAttributed: number;
    };
    conversions: {
        total: number;
        orderAmount: number;
        commission: number;
    };
    earnings: {
        pending: number;
        available: number;
        reversed: number;
    };
    wallet: {
        balance: number;
        totalEarned: number;
    };
}

// The affiliate program's commission is resolved from `CommissionRule` (scope
// PRODUCT / PRODUCT_VARIANT / OPERATOR_OFFER / GLOBAL). There is no per-product
// affiliate rate column on Product, so an unconfigured rule means no commission —
// a rate is never invented.
export interface IAffiliateConversionInput {
    productOrderId: string;
    customerUserId: string;
    productId: string;
    lineAmount: number;
}
