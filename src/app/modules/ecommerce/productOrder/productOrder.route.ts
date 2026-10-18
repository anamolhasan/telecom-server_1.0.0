import { Router } from "express";
import { checkAuth } from "../../../middleware/checkAuth";
import { validateRequest } from "../../../middleware/validateRequest";
import { ORDER_STAFF_ROLES } from "../../../constants/rbac.constant";
import { ProductOrderController } from "./productOrder.controller";
import { ProductOrderValidation } from "./productOrder.validation";

const router = Router();

// ─── Customer routes ────────────────────────────────────────────────────────
// Any authenticated account checks out its own cart: the cart, the prices, the
// stock and the buyer identity all come from the server session, so nothing
// about another user's cart or orders is reachable here.
router.post(
    "/checkout",
    checkAuth(),
    validateRequest(ProductOrderValidation.checkoutZodSchema),
    ProductOrderController.checkout,
);

// Declared before "/:id" so the literal "my" is never read as an order id.
router.get("/my", checkAuth(), ProductOrderController.getMyOrders);
router.get("/my/:id", checkAuth(), ProductOrderController.getMyOrder);

// ─── Staff routes ───────────────────────────────────────────────────────────
// Reuses the existing order-staff role set that already guards the Telecom order
// operations, and keeps fulfilment separate from payment collection.
router.get(
    "/",
    checkAuth(...ORDER_STAFF_ROLES),
    ProductOrderController.getAllProductOrders,
);
router.get(
    "/:id",
    checkAuth(...ORDER_STAFF_ROLES),
    ProductOrderController.getProductOrderById,
);
router.patch(
    "/:id/status",
    checkAuth(...ORDER_STAFF_ROLES),
    validateRequest(ProductOrderValidation.updateProductOrderStatusZodSchema),
    ProductOrderController.updateOrderStatus,
);
router.patch(
    "/:id/payment",
    checkAuth(...ORDER_STAFF_ROLES),
    validateRequest(ProductOrderValidation.updateProductOrderPaymentZodSchema),
    ProductOrderController.updateOrderPayment,
);

export const ProductOrderRoutes = router;
