import { Router } from "express";
import { CONTENT_ADMIN_ROLES } from "../../../constants/rbac.constant";
import { checkAuth, checkAuthOptional } from "../../../middleware/checkAuth";
import { validateRequest } from "../../../middleware/validateRequest";
import { OperatorOfferController } from "./operatorOffer.controller";
import { operatorOfferValidation } from "./operatorOffer.validation";

const router = Router();

// Public catalogue reads (matches the previous /products convention). The
// optional auth step lets authenticated content admins receive the full
// (commercial) offer, while anonymous and non-admin callers get the public
// projection only.
router.get("/", checkAuthOptional, OperatorOfferController.getAllOperatorOffers);
router.get(
    "/:id",
    checkAuthOptional,
    OperatorOfferController.getOperatorOfferById,
);

// Administrative writes are restricted to content admins.
router.post(
    "/",
    checkAuth(...CONTENT_ADMIN_ROLES),
    validateRequest(operatorOfferValidation.createOperatorOfferZodSchema),
    OperatorOfferController.createOperatorOffer,
);
router.patch(
    "/:id",
    checkAuth(...CONTENT_ADMIN_ROLES),
    validateRequest(operatorOfferValidation.updateOperatorOfferZodSchema),
    OperatorOfferController.updateOperatorOffer,
);
router.patch(
    "/:id/status",
    checkAuth(...CONTENT_ADMIN_ROLES),
    validateRequest(operatorOfferValidation.changeOperatorOfferStatusZodSchema),
    OperatorOfferController.changeOperatorOfferStatus,
);
router.delete(
    "/:id",
    checkAuth(...CONTENT_ADMIN_ROLES),
    OperatorOfferController.archiveOperatorOffer,
);

export const OperatorOfferRoutes = router;
