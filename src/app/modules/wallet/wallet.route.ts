import { Router } from "express";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { WalletController } from "./wallet.controller";
import { WalletValidation } from "./wallet.validation";
import { CUSTOMER_ROLES, FINANCE_ROLES } from "../../constants/rbac.constant";


const router = Router();

router.get(
    "/me",
    checkAuth(...CUSTOMER_ROLES),
    WalletController.getMyWallet,
);
router.get(
    "/transactions",
    checkAuth(...CUSTOMER_ROLES),
    WalletController.getMyWalletTransactions,
);
router.post(
    "/adjust",
    checkAuth(...FINANCE_ROLES),
    validateRequest(WalletValidation.adjustWalletZodSchema),
    WalletController.adjustWallet,
);

export const WalletRoutes = router;
