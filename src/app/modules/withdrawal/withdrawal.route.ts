import { Router } from "express";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { WithdrawalController } from "./withdrawal.controller";
import { WithdrawalValidation } from "./withdrawal.validation";
import { CUSTOMER_ROLES, FINANCE_ROLES, WITHDRAWAL_STAFF_ROLES } from "../../constants/rbac.constant";


const router = Router();

router.post(
    "/",
    checkAuth(...CUSTOMER_ROLES),
    validateRequest(WithdrawalValidation.createWithdrawalZodSchema),
    WithdrawalController.requestWithdrawal,
);
router.get(
    "/my",
    checkAuth(...CUSTOMER_ROLES),
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
