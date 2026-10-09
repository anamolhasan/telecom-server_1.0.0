import { Router } from "express";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { ProductController } from "./product.controller";
import { ProductValidation } from "./product.validation";
import { CONTENT_ADMIN_ROLES } from "../../constants/rbac.constant";


const router = Router();

router.post(
    "/",
    checkAuth(...CONTENT_ADMIN_ROLES),
    validateRequest(ProductValidation.createProductZodSchema),
    ProductController.createProduct,
);
router.get("/", ProductController.getAllProducts);
router.get("/:id", ProductController.getProductById);
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
