import { Router } from "express";
import { CONTENT_ADMIN_ROLES } from "../../../constants/rbac.constant";
import { checkAuth, checkAuthOptional } from "../../../middleware/checkAuth";
import { validateRequest } from "../../../middleware/validateRequest";
import { ProductVariantController } from "./productVariant.controller";
import { ProductVariantValidation } from "./productVariant.validation";

const router = Router();

// Public catalogue reads (content admins additionally see unpublished SKUs).
router.get("/", checkAuthOptional, ProductVariantController.getAllProductVariants);
router.get(
    "/:id",
    checkAuthOptional,
    ProductVariantController.getProductVariantById,
);

// Catalog management is restricted to content admins (SUPER_ADMIN / ADMIN) —
// the same guard used by the Operator and OperatorOffer modules.
router.post(
    "/",
    checkAuth(...CONTENT_ADMIN_ROLES),
    validateRequest(ProductVariantValidation.createProductVariantZodSchema),
    ProductVariantController.createProductVariant,
);
router.patch(
    "/:id",
    checkAuth(...CONTENT_ADMIN_ROLES),
    validateRequest(ProductVariantValidation.updateProductVariantZodSchema),
    ProductVariantController.updateProductVariant,
);
router.delete(
    "/:id",
    checkAuth(...CONTENT_ADMIN_ROLES),
    ProductVariantController.deleteProductVariant,
);

export const ProductVariantRoutes = router;
