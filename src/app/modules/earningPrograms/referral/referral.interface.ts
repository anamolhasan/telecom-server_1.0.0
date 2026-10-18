import {
    ReferralApplicationStatus,
    WalletTransactionReason,
} from "../../../../generated/prisma/enums";

export interface IGrantReferralIncomePayload {
    appUserId: string;
    orderId: string;
    amount: number;
    reason?: WalletTransactionReason;
    // Optional context used only to freeze the commission-rule snapshot on the
    // immutable earning-ledger row. Never used to compute the amount.
    baseAmount?: number;
    ruleValue?: number;
    offerId?: string | null;
}

// How the one-time referral milestone reward is priced. Deliberately read from
// SystemSetting rather than hard-coded: the business amount is not defined by the
// codebase (see the exported setting key).
export interface IReferralMilestoneConfig {
    // BDT amount for the reward. 0 (and `configured: false`) means the business
    // amount is not configured yet, so no reward is issued.
    amount: number;
    currency: string;
    requiredReferralCount: number;
    configured: boolean;
    settingKey: string;
}

export interface IReferralMilestoneState {
    requiredReferralCount: number;
    activeReferralCount: number;
    qualified: boolean;
    awarded: boolean;
    awardedAt: Date | null;
    amount: number;
    currency: string;
    configured: boolean;
    settingKey: string;
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
    // null when the caller has not submitted a Referral application yet. The
    // dashboard is programme participation, not a reward decision, so it is
    // readable before approval; only `referralIncomeEligible` reflects the
    // approved-application rule.
    applicationStatus: ReferralApplicationStatus | null;
    totalReferredCount: number;
    activeReferredCount: number;
    targetActiveReferrals: number;
    referralIncomeEligible: boolean;
    referrals: IPartnerReferralItem[];
}

export interface IDefaultReferralCode {
    referralCode: string | null;
}