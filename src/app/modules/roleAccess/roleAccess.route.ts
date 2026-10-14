import { Router } from "express";
import { ROLE_ACCESS_MANAGERS } from "../../constants/rbac.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { RoleAccessController } from "./roleAccess.controller";

const router = Router();

// Role Access Management is SUPER_ADMIN-only. checkAuth returns 401 when the
// caller is unauthenticated and 403 when authenticated without the required
// role, matching the existing API conventions (see the settings routes).
router.get(
    "/",
    checkAuth(...ROLE_ACCESS_MANAGERS),
    RoleAccessController.getRoleAccess,
);

export const RoleAccessRoutes = router;
