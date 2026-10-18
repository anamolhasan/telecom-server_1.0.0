import { Router } from "express";
import { checkAuth } from "../../../../middleware/checkAuth";
import { requireApprovedProgram } from "../../../../middleware/requireApprovedProgram";
import { validateRequest } from "../../../../middleware/validateRequest";
import { AffiliateController } from "./affiliate.controller";
import { AffiliateValidation } from "./affiliate.validation";

const router = Router();

// ─── Application status + dashboard ──────────────────────────────────────────
// Any authenticated account may read this; nothing program-specific is returned
// until the Affiliate application is approved.
router.get("/dashboard", checkAuth(), AffiliateController.getAffiliateDashboard);

// ─── Attribution ─────────────────────────────────────────────────────────────
// A customer's visit, not an affiliate action: any authenticated account may
// record one. Membership is derived from the persisted APPROVED application on
// the link owner's side, never from the visitor's role.
router.post(
    "/visit",
    checkAuth(),
    validateRequest(AffiliateValidation.trackAffiliateVisitZodSchema),
    AffiliateController.trackAffiliateVisit,
);

// ─── Approved-affiliate-only views ───────────────────────────────────────────
// Membership is re-derived from the persisted APPROVED application, never from
// the account's role. Every query below is scoped to the caller.
router.post(
    "/links",
    checkAuth(),
    requireApprovedProgram("affiliate"),
    validateRequest(AffiliateValidation.createAffiliateLinkZodSchema),
    AffiliateController.createAffiliateLink,
);
router.get(
    "/links",
    checkAuth(),
    requireApprovedProgram("affiliate"),
    AffiliateController.getMyAffiliateLinks,
);
router.patch(
    "/links/:id",
    checkAuth(),
    requireApprovedProgram("affiliate"),
    validateRequest(AffiliateValidation.updateAffiliateLinkZodSchema),
    AffiliateController.updateMyAffiliateLink,
);
router.get(
    "/conversions",
    checkAuth(),
    requireApprovedProgram("affiliate"),
    AffiliateController.getMyConversions,
);
router.get(
    "/earnings",
    checkAuth(),
    requireApprovedProgram("affiliate"),
    AffiliateController.getMyAffiliateEarnings,
);

export const AffiliateRoutes = router;
