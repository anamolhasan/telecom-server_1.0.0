import { Router } from "express";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { OperatorController } from "./operator.controller";
import { OperatorValidation } from "./operator.validation";
import { CONTENT_ADMIN_ROLES } from "../../constants/rbac.constant";


const router = Router();

router.post(
    "/",
    checkAuth(...CONTENT_ADMIN_ROLES),
    validateRequest(OperatorValidation.createOperatorZodSchema),
    OperatorController.createOperator,
);
router.get("/", OperatorController.getAllOperators);
router.get("/:id", OperatorController.getOperatorById);
router.patch(
    "/:id",
    checkAuth(...CONTENT_ADMIN_ROLES),
    validateRequest(OperatorValidation.updateOperatorZodSchema),
    OperatorController.updateOperator,
);
router.delete(
    "/:id",
    checkAuth(...CONTENT_ADMIN_ROLES),
    OperatorController.deleteOperator,
);

export const OperatorRoutes = router;
