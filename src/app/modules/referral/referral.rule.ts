import {
    OrderStatus,
    PaymentStatus,
    ReferralApplicationStatus,
} from "../../../generated/prisma/enums";
import {
    REFERRAL_ACTIVE_MONTHS,
    REFERRAL_MIN_ACTIVE_REFERRALS,
} from "../../constants/telecom.constant";

export interface IOrderQualification {
    status: OrderStatus;
    paymentStatus: PaymentStatus;
    completedAt: Date | null;
}

export const subtractMonths = (date: Date, months: number): Date => {
    const result = new Date(date);
    result.setMonth(result.getMonth() - months);
    return result;
};

export const isWithinRollingWindow = (date: Date, now: Date = new Date()): boolean =>
    date >= subtractMonths(now, REFERRAL_ACTIVE_MONTHS);

// A referred account is ACTIVE when the referred user has at least one qualifying
// offer purchase successfully completed within the rolling previous N months.
// Cancelled, failed, pending, unfulfilled and fully refunded purchases do not qualify.
export const qualifiesAsActiveReferredPurchase = (
    order: IOrderQualification,
    now: Date = new Date(),
): boolean =>
    order.status === OrderStatus.COMPLETED &&
    order.paymentStatus === PaymentStatus.PAID &&
    order.completedAt !== null &&
    isWithinRollingWindow(order.completedAt, now);

export interface IReferralEligibility {
    approved: boolean;
    activeReferredCount: number;
    eligible: boolean;
}

// Referral Income is earned only when the user's application is APPROVED AND the user
// currently has at least the minimum distinct active referred accounts.
// Eligibility is fully derived; approval is permanent, active-account count is dynamic.
export const computeReferralEligibility = (
    applicationStatus: ReferralApplicationStatus | null,
    activeReferredCount: number,
): IReferralEligibility => {
    const approved = applicationStatus === ReferralApplicationStatus.APPROVED;
    return {
        approved,
        activeReferredCount,
        eligible: approved && activeReferredCount >= REFERRAL_MIN_ACTIVE_REFERRALS,
    };
};