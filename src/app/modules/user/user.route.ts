import { Router } from "express";
import { ROLE_MANAGEMENT_ACTORS } from "../../constants/rbac.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { UserController } from "./user.controller";
import { UserValidation } from "./user.validation";

const router = Router();

router.post(
    "/",
    checkAuth(...ROLE_MANAGEMENT_ACTORS),
    validateRequest(UserValidation.createStaffUserZodSchema),
    UserController.createStaffAccount,
);
router.get("/", checkAuth(...ROLE_MANAGEMENT_ACTORS), UserController.getUsers);
router.get("/:id", checkAuth(...ROLE_MANAGEMENT_ACTORS), UserController.getUserById);
router.patch(
    "/:id",
    checkAuth(...ROLE_MANAGEMENT_ACTORS),
    validateRequest(UserValidation.updateUserProfileZodSchema),
    UserController.updateProfile,
);
router.patch(
    "/:id/status",
    checkAuth(...ROLE_MANAGEMENT_ACTORS),
    validateRequest(UserValidation.updateUserStatusZodSchema),
    UserController.updateStatus,
);
router.patch(
    "/:id/role",
    checkAuth(...ROLE_MANAGEMENT_ACTORS),
    validateRequest(UserValidation.updateUserRoleZodSchema),
    UserController.changeRole,
);
router.delete("/:id", checkAuth(...ROLE_MANAGEMENT_ACTORS), UserController.softDeleteUser);

export const UserRoutes = router;