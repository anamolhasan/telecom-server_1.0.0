import { Router } from "express";
import { CONTENT_ADMIN_ROLES } from "../../../constants/rbac.constant";
import { checkAuth } from "../../../middleware/checkAuth";
import { validateRequest } from "../../../middleware/validateRequest";
import { InventoryController } from "./inventory.controller";
import { InventoryValidation } from "./inventory.validation";

const router = Router();

// Stock is an operations concern: every inventory route is restricted to content
// admins (SUPER_ADMIN / ADMIN), so a client can never submit a stock value. The
// cart module only ever reads stock, and only as a display/availability signal.
router.get(
    "/",
    checkAuth(...CONTENT_ADMIN_ROLES),
    InventoryController.getAllInventory,
);
router.get(
    "/:variantId",
    checkAuth(...CONTENT_ADMIN_ROLES),
    InventoryController.getInventoryByVariantId,
);
router.put(
    "/:variantId",
    checkAuth(...CONTENT_ADMIN_ROLES),
    validateRequest(InventoryValidation.setInventoryZodSchema),
    InventoryController.setInventory,
);
router.post(
    "/:variantId/adjust",
    checkAuth(...CONTENT_ADMIN_ROLES),
    validateRequest(InventoryValidation.adjustInventoryZodSchema),
    InventoryController.adjustInventory,
);

export const InventoryRoutes = router;
