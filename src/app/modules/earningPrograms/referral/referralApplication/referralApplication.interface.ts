import {
    ReferralApplicationStatus,
    ReferralPromotionMethod,
} from "../../../../../generated/prisma/enums";

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
