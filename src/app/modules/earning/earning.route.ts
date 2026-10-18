import { Router } from "express";
import { FINANCE_ROLES } from "../../constants/rbac.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { EarningController } from "./earning.controller";
import { EarningValidation } from "./earning.validation";

const router = Router();

// ─── Any authenticated account ───────────────────────────────────────────────
// Every role may hold earnings, so earning history is scoped to the caller
// (`req.user`) rather than to a role.
router.get("/me", checkAuth(), EarningController.getMyEarnings);
// Declared before any "/me/:x" style route so "summary" is never read as an id.
router.get("/me/summary", checkAuth(), EarningController.getMyEarningSummary);

// ─── Finance / administration ────────────────────────────────────────────────
// Commission configuration is sensitive commercial data: only finance roles may
// read or change it, and no earning balance can be modified through this API.
router.get(
    "/rules",
    checkAuth(...FINANCE_ROLES),
    EarningController.listCommissionRules,
);
router.post(
    "/rules",
    checkAuth(...FINANCE_ROLES),
    validateRequest(EarningValidation.createCommissionRuleZodSchema),
    EarningController.createCommissionRule,
);
router.patch(
    "/rules/:id",
    checkAuth(...FINANCE_ROLES),
    validateRequest(EarningValidation.updateCommissionRuleZodSchema),
    EarningController.updateCommissionRule,
);

export const EarningRoutes = router;
