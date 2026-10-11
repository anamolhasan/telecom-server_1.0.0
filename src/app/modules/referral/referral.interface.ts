import {
    ReferralApplicationStatus,
    ReferralPromotionMethod,
    WalletTransactionReason,
} from "../../../generated/prisma/enums";

export interface ISubmitReferralApplicationPayload {
    promotionMethod?: ReferralPromotionMethod;
    promotionUrl?: string;
    reason?: string;
    termsAccepted?: boolean;
}

export interface IReviewReferralApplicationPayload {
    status: ReferralApplicationStatus;
    rejectionReason?: string;
}

export interface IGrantReferralIncomePayload {
    appUserId: string;
    orderId: string;
    amount: number;
    reason?: WalletTransactionReason;
}

export interface IReconcileReferralResult {
    evaluated: number;
    eligible: number;
}

export interface IPartnerReferralItem {
    id: string;
    name: string;
    email: string;
    joinedAt: Date;
    isActive: boolean;
}

export interface IPartnerReferralDashboard {
    referralCode: string;
    applicationStatus: ReferralApplicationStatus;
    totalReferredCount: number;
    activeReferredCount: number;
    targetActiveReferrals: number;
    referralIncomeEligible: boolean;
    referrals: IPartnerReferralItem[];
}

export interface IDefaultReferralCode {
    referralCode: string | null;
}