import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { ReferralController } from "./referral.controller";
import { ReferralValidation } from "./referral.validation";


const router = Router();

router.post(
    "/apply",
    checkAuth(Role.USER, Role.AGENT),
    ReferralController.applyForReferralIncome,
);
router.get(
    "/me",
    checkAuth(Role.USER, Role.AGENT),
    ReferralController.getMyReferral,
);
router.get(
    "/applications",
    checkAuth(Role.SUPER_ADMIN, Role.ADMIN),
    ReferralController.getAllApplications,
);
router.patch(
    "/applications/:id/review",
    checkAuth(Role.SUPER_ADMIN, Role.ADMIN),
    validateRequest(ReferralValidation.reviewReferralApplicationZodSchema),
    ReferralController.reviewApplication,
);

export const ReferralRoutes = router;