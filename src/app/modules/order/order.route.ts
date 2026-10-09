import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { OrderController } from "./order.controller";
import { OrderValidation } from "./order.validation";


const router = Router();

router.post(
    "/",
    checkAuth(Role.USER, Role.AGENT),
    validateRequest(OrderValidation.createOrderZodSchema),
    OrderController.createOrder,
);
router.get(
    "/my",
    checkAuth(Role.USER, Role.AGENT),
    OrderController.getMyOrders,
);
router.get(
    "/my/:id",
    checkAuth(Role.USER, Role.AGENT),
    OrderController.getMyOrder,
);
router.post(
    "/:id/pay",
    checkAuth(Role.USER, Role.AGENT),
    OrderController.initiatePayment,
);
router.get(
    "/",
    checkAuth(Role.SUPER_ADMIN, Role.ADMIN, Role.SUPPORT, Role.STAFF),
    OrderController.getAllOrders,
);
router.patch(
    "/:id/status",
    checkAuth(Role.SUPER_ADMIN, Role.ADMIN, Role.SUPPORT, Role.STAFF),
    validateRequest(OrderValidation.updateOrderStatusZodSchema),
    OrderController.changeOrderStatus,
);

export const OrderRoutes = router;
