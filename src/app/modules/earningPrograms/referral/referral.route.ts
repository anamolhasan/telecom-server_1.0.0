import { Router } from "express";
import { checkAuth } from "../../../middleware/checkAuth";
import { requireApprovedProgram } from "../../../middleware/requireApprovedProgram";
import { validateRequest } from "../../../middleware/validateRequest";
import { ReferralController } from "./referral.controller";
import { ReferralApplicationValidation } from "./referralApplication/referralApplication.validation";
import { FINANCE_ROLES } from "../../../constants/rbac.constant";


const router = Router();

// Any authenticated account may apply for the Referral program; approval is
// decided by the review step only and is independent of the account's role.
router.post(
    "/apply",
    checkAuth(),
    validateRequest(ReferralApplicationValidation.submitReferralApplicationZodSchema),
    ReferralController.applyForReferralIncome,
);
router.get(
    "/me",
    checkAuth(),
    ReferralController.getMyReferral,
);
router.get(
    "/default-code",
    ReferralController.getDefaultReferralCode,
);
// ─── Programme participation (any authenticated account) ─────────────────────
// The partner view is the Referral programme's dashboard, exactly like
// `/agent/dashboard` and `/affiliate/dashboard`. Any authenticated account may
// read it — regardless of its system role and before any approval — because the
// payload is the caller's own participation data: their referral code, their own
// referred accounts and the status of their own application. Sharing a referral
// link is programme participation, not a reward decision, so it must not require
// an approved application. Reward eligibility is never granted here: it is
// re-derived from the persisted APPROVED application inside the service (and
// again inside the transaction that moves money), so an unapproved caller sees a
// zeroed, self-scoped view.
router.get(
    "/partner",
    checkAuth(),
    ReferralController.getPartnerReferral,
);
// The one-time milestone state for the caller (progress, award, and — while the
// business amount is unset — that it is still unconfigured). Any authenticated
// account may see its own state.
router.get(
    "/milestone",
    checkAuth(),
    ReferralController.getMyMilestone,
);

// ─── Reward-bearing views (approved referral partner only) ───────────────────
// Same gate as the Agent and Affiliate earning views: the programme's own
// eligibility rule is the persisted APPROVED application, re-read per request and
// never taken from the account's role. This hides no real money — an account
// without an approved application cannot own a REFERRAL earning at all, because
// grantReferralIncome re-derives referral eligibility inside the transaction.
router.get(
    "/earnings",
    checkAuth(),
    requireApprovedProgram("referral"),
    ReferralController.getMyReferralEarnings,
);
router.get(
    "/applications",
    checkAuth(...FINANCE_ROLES),
    ReferralController.getAllApplications,
);
router.patch(
    "/applications/:id/review",
    checkAuth(...FINANCE_ROLES),
    validateRequest(ReferralApplicationValidation.reviewReferralApplicationZodSchema),
    ReferralController.reviewApplication,
);

export const ReferralRoutes = router;