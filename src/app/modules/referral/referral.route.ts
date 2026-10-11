import { Router } from "express";
import { checkAuth } from "../../middleware/checkAuth";
import { requireReferralPartner } from "../../middleware/requireReferralPartner";
import { validateRequest } from "../../middleware/validateRequest";
import { ReferralController } from "./referral.controller";
import { ReferralValidation } from "./referral.validation";
import { CUSTOMER_ROLES, FINANCE_ROLES } from "../../constants/rbac.constant";


const router = Router();

router.post(
    "/apply",
    checkAuth(...CUSTOMER_ROLES),
    validateRequest(ReferralValidation.submitReferralApplicationZodSchema),
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
router.get(
    "/partner",
    checkAuth(...CUSTOMER_ROLES),
    requireReferralPartner,
    ReferralController.getPartnerReferral,
);
router.get(
    "/applications",
    checkAuth(...FINANCE_ROLES),
    ReferralController.getAllApplications,
);
router.patch(
    "/applications/:id/review",
    checkAuth(...FINANCE_ROLES),
    validateRequest(ReferralValidation.reviewReferralApplicationZodSchema),
    ReferralController.reviewApplication,
);

export const ReferralRoutes = router;