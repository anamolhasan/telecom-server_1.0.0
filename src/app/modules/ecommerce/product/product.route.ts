import { Router } from "express";
import { CONTENT_ADMIN_ROLES } from "../../../constants/rbac.constant";
import { checkAuth, checkAuthOptional } from "../../../middleware/checkAuth";
import { validateRequest } from "../../../middleware/validateRequest";
import { ProductController } from "./product.controller";
import { ProductValidation } from "./product.validation";

const router = Router();

// Public catalogue reads (content admins additionally see drafts/archived rows).
router.get("/", checkAuthOptional, ProductController.getAllProducts);
router.get("/:id", checkAuthOptional, ProductController.getProductById);

// Catalog management is restricted to content admins (SUPER_ADMIN / ADMIN) —
// the same guard used by the Operator and OperatorOffer modules.
router.post(
    "/",
    checkAuth(...CONTENT_ADMIN_ROLES),
    validateRequest(ProductValidation.createProductZodSchema),
    ProductController.createProduct,
);
router.patch(
    "/:id",
    checkAuth(...CONTENT_ADMIN_ROLES),
    validateRequest(ProductValidation.updateProductZodSchema),
    ProductController.updateProduct,
);
router.delete(
    "/:id",
    checkAuth(...CONTENT_ADMIN_ROLES),
    ProductController.deleteProduct,
);

export const ProductRoutes = router;
