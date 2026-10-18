import { AffiliateApplicationStatus } from "../../../../../generated/prisma/enums";

export interface ISubmitAffiliateApplicationPayload {
    reason?: string;
}

export interface IReviewAffiliateApplicationPayload {
    status: AffiliateApplicationStatus;
    rejectionReason?: string;
}
