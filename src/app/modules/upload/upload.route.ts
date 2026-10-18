import { Router } from "express";
import { CONTENT_ADMIN_ROLES } from "../../constants/rbac.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { uploadSingleImage } from "../../middleware/upload.middleware";
import { UploadController } from "./upload.controller";

const router = Router();

// Generic content-image ingestion. Restricted to content admins because the
// endpoint is not bound to any owned resource yet; per-domain (avatar, logo)
// endpoints can relax this later with their own authorization and binding.
router.post(
    "/image",
    checkAuth(...CONTENT_ADMIN_ROLES),
    ...uploadSingleImage("file"),
    UploadController.uploadImage,
);

export const UploadRoutes = router;
