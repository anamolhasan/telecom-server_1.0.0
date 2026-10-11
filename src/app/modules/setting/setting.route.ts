import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { SettingController } from "./setting.controller";
import { SettingValidation } from "./setting.validation";


const router = Router();

router.get(
    "/referral-default",
    checkAuth(Role.SUPER_ADMIN),
    SettingController.getDefaultReferralSetting,
);
router.patch(
    "/referral-default",
    checkAuth(Role.SUPER_ADMIN),
    validateRequest(SettingValidation.updateDefaultReferralSettingZodSchema),
    SettingController.updateDefaultReferralSetting,
);

export const SettingRoutes = router;