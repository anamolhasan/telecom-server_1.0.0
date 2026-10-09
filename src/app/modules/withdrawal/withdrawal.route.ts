import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { WithdrawalController } from "./withdrawal.controller";
import { WithdrawalValidation } from "./withdrawal.validation";


const router = Router();

router.post(
    "/",
    checkAuth(Role.USER, Role.AGENT),
    validateRequest(WithdrawalValidation.createWithdrawalZodSchema),
    WithdrawalController.requestWithdrawal,
);
router.get(
    "/my",
    checkAuth(Role.USER, Role.AGENT),
    WithdrawalController.getMyWithdrawals,
);
router.get(
    "/",
    checkAuth(Role.SUPER_ADMIN, Role.ADMIN, Role.SUPPORT, Role.STAFF),
    WithdrawalController.getAllWithdrawals,
);
router.patch(
    "/:id/status",
    checkAuth(Role.SUPER_ADMIN, Role.ADMIN),
    validateRequest(WithdrawalValidation.updateWithdrawalStatusZodSchema),
    WithdrawalController.updateWithdrawalStatus,
);

export const WithdrawalRoutes = router;
