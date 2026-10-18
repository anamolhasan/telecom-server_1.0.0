import { Router } from "express";
import { AFFILIATE_APPLICATION_ACTORS } from "../../../../constants/rbac.constant";
import { checkAuth } from "../../../../middleware/checkAuth";
import { validateRequest } from "../../../../middleware/validateRequest";
import { AffiliateApplicationController } from "./affiliateApplication.controller";
import { AffiliateApplicationValidation } from "./affiliateApplication.validation";


const router = Router();

// Every authenticated account may apply for the Affiliate program. Approval is
// decided solely by the review step, never by the account's system role.
router.post(
    "/",
    checkAuth(),
    validateRequest(AffiliateApplicationValidation.submitAffiliateApplicationZodSchema),
    AffiliateApplicationController.submitAffiliateApplication,
);
router.get(
    "/me",
    checkAuth(),
    AffiliateApplicationController.getMyAffiliateApplication,
);
router.get(
    "/",
    checkAuth(...AFFILIATE_APPLICATION_ACTORS),
    AffiliateApplicationController.getAllAffiliateApplications,
);
router.patch(
    "/:id/review",
    checkAuth(...AFFILIATE_APPLICATION_ACTORS),
    validateRequest(AffiliateApplicationValidation.reviewAffiliateApplicationZodSchema),
    AffiliateApplicationController.reviewAffiliateApplication,
);

export const AffiliateApplicationRoutes = router;
