import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { OperatorController } from "./operator.controller";
import { OperatorValidation } from "./operator.validation";


const router = Router();

router.post(
    "/",
    checkAuth(Role.SUPER_ADMIN, Role.ADMIN),
    validateRequest(OperatorValidation.createOperatorZodSchema),
    OperatorController.createOperator,
);
router.get("/", OperatorController.getAllOperators);
router.get("/:id", OperatorController.getOperatorById);
router.patch(
    "/:id",
    checkAuth(Role.SUPER_ADMIN, Role.ADMIN),
    validateRequest(OperatorValidation.updateOperatorZodSchema),
    OperatorController.updateOperator,
);
router.delete(
    "/:id",
    checkAuth(Role.SUPER_ADMIN, Role.ADMIN),
    OperatorController.deleteOperator,
);

export const OperatorRoutes = router;
