import { Router } from "express";
import { checkAuth } from "../../../middleware/checkAuth";
import { validateRequest } from "../../../middleware/validateRequest";
import { CartController } from "./cart.controller";
import { CartValidation } from "./cart.validation";

const router = Router();

// The cart is a per-user resource: any authenticated account (customer or staff)
// manages its own cart. `checkAuth()` with no roles means "any signed-in, active
// account", and every handler resolves the cart from that account only — no
// endpoint accepts a cart id, so another user's cart is unreachable.
router.get("/", checkAuth(), CartController.getMyCart);
router.post(
    "/items",
    checkAuth(),
    validateRequest(CartValidation.addCartItemZodSchema),
    CartController.addCartItem,
);
router.patch(
    "/items/:itemId",
    checkAuth(),
    validateRequest(CartValidation.updateCartItemZodSchema),
    CartController.updateCartItem,
);
router.delete("/items/:itemId", checkAuth(), CartController.removeCartItem);
router.delete("/", checkAuth(), CartController.clearCart);

export const CartRoutes = router;
