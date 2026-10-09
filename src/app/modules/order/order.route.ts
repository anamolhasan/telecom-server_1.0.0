import { Router } from "express";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { OrderController } from "./order.controller";
import { OrderValidation } from "./order.validation";
import { CUSTOMER_ROLES, ORDER_STAFF_ROLES } from "../../constants/rbac.constant";


const router = Router();

router.post(
    "/",
    checkAuth(...CUSTOMER_ROLES),
    validateRequest(OrderValidation.createOrderZodSchema),
    OrderController.createOrder,
);
router.get(
    "/my",
    checkAuth(...CUSTOMER_ROLES),
    OrderController.getMyOrders,
);
router.get(
    "/my/:id",
    checkAuth(...CUSTOMER_ROLES),
    OrderController.getMyOrder,
);
router.post(
    "/:id/pay",
    checkAuth(...CUSTOMER_ROLES),
    OrderController.initiatePayment,
);
router.get(
    "/",
    checkAuth(...ORDER_STAFF_ROLES),
    OrderController.getAllOrders,
);
router.patch(
    "/:id/status",
    checkAuth(...ORDER_STAFF_ROLES),
    validateRequest(OrderValidation.updateOrderStatusZodSchema),
    OrderController.changeOrderStatus,
);

export const OrderRoutes = router;
