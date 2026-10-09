import {
    ReferralApplicationStatus,
    WalletTransactionReason,
} from "../../../generated/prisma/enums";

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