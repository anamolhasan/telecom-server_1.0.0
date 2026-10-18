import { Router } from "express";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { WithdrawalController } from "./withdrawal.controller";
import { WithdrawalValidation } from "./withdrawal.validation";
import { FINANCE_ROLES, WITHDRAWAL_STAFF_ROLES } from "../../constants/rbac.constant";


const router = Router();

// Any authenticated account owns a wallet and may request a withdrawal of its
// own available balance; no role restriction applies to the earning side.
router.post(
    "/",
    checkAuth(),
    validateRequest(WithdrawalValidation.createWithdrawalZodSchema),
    WithdrawalController.requestWithdrawal,
);
router.get(
    "/my",
    checkAuth(),
    WithdrawalController.getMyWithdrawals,
);
router.get(
    "/",
    checkAuth(...WITHDRAWAL_STAFF_ROLES),
    WithdrawalController.getAllWithdrawals,
);
router.patch(
    "/:id/status",
    checkAuth(...FINANCE_ROLES),
    validateRequest(WithdrawalValidation.updateWithdrawalStatusZodSchema),
    WithdrawalController.updateWithdrawalStatus,
);

export const WithdrawalRoutes = router;
