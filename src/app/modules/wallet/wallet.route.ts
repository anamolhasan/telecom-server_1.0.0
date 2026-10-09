import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { WalletController } from "./wallet.controller";
import { WalletValidation } from "./wallet.validation";


const router = Router();

router.get(
    "/me",
    checkAuth(Role.USER, Role.AGENT),
    WalletController.getMyWallet,
);
router.get(
    "/transactions",
    checkAuth(Role.USER, Role.AGENT),
    WalletController.getMyWalletTransactions,
);
router.post(
    "/adjust",
    checkAuth(Role.SUPER_ADMIN, Role.ADMIN),
    validateRequest(WalletValidation.adjustWalletZodSchema),
    WalletController.adjustWallet,
);

export const WalletRoutes = router;
