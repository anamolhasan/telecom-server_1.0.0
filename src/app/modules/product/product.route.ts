import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { ProductController } from "./product.controller";
import { ProductValidation } from "./product.validation";


const router = Router();

router.post(
    "/",
    checkAuth(Role.SUPER_ADMIN, Role.ADMIN),
    validateRequest(ProductValidation.createProductZodSchema),
    ProductController.createProduct,
);
router.get("/", ProductController.getAllProducts);
router.get("/:id", ProductController.getProductById);
router.patch(
    "/:id",
    checkAuth(Role.SUPER_ADMIN, Role.ADMIN),
    validateRequest(ProductValidation.updateProductZodSchema),
    ProductController.updateProduct,
);
router.delete(
    "/:id",
    checkAuth(Role.SUPER_ADMIN, Role.ADMIN),
    ProductController.deleteProduct,
);

export const ProductRoutes = router;
