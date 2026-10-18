import { Router } from "express";
import { CONTENT_ADMIN_ROLES } from "../../../constants/rbac.constant";
import { checkAuth, checkAuthOptional } from "../../../middleware/checkAuth";
import { validateRequest } from "../../../middleware/validateRequest";
import { BrandController } from "./brand.controller";
import { BrandValidation } from "./brand.validation";

const router = Router();

// Public catalogue reads (content admins additionally see unpublished brands).
router.get("/", checkAuthOptional, BrandController.getAllBrands);
router.get("/:id", checkAuthOptional, BrandController.getBrandById);

// Catalog management is restricted to content admins (SUPER_ADMIN / ADMIN) —
// the same guard used by the Operator and OperatorOffer modules.
router.post(
    "/",
    checkAuth(...CONTENT_ADMIN_ROLES),
    validateRequest(BrandValidation.createBrandZodSchema),
    BrandController.createBrand,
);
router.patch(
    "/:id",
    checkAuth(...CONTENT_ADMIN_ROLES),
    validateRequest(BrandValidation.updateBrandZodSchema),
    BrandController.updateBrand,
);
router.delete(
    "/:id",
    checkAuth(...CONTENT_ADMIN_ROLES),
    BrandController.deleteBrand,
);

export const BrandRoutes = router;
