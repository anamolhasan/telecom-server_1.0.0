import { Router } from "express";
import { CONTENT_ADMIN_ROLES } from "../../../constants/rbac.constant";
import { checkAuth, checkAuthOptional } from "../../../middleware/checkAuth";
import { validateRequest } from "../../../middleware/validateRequest";
import { CategoryController } from "./category.controller";
import { CategoryValidation } from "./category.validation";

const router = Router();

// Public catalogue reads. The optional auth step lets an authenticated content
// admin receive drafts/inactive rows, while anonymous and customer callers get
// the published projection only.
router.get("/", checkAuthOptional, CategoryController.getAllCategories);
router.get("/:id", checkAuthOptional, CategoryController.getCategoryById);

// Catalog management is restricted to content admins (SUPER_ADMIN / ADMIN) —
// the same guard used by the Operator and OperatorOffer modules.
router.post(
    "/",
    checkAuth(...CONTENT_ADMIN_ROLES),
    validateRequest(CategoryValidation.createCategoryZodSchema),
    CategoryController.createCategory,
);
router.patch(
    "/:id",
    checkAuth(...CONTENT_ADMIN_ROLES),
    validateRequest(CategoryValidation.updateCategoryZodSchema),
    CategoryController.updateCategory,
);
router.delete(
    "/:id",
    checkAuth(...CONTENT_ADMIN_ROLES),
    CategoryController.deleteCategory,
);

export const CategoryRoutes = router;
