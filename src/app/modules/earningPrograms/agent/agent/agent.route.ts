import { Router } from "express";
import { checkAuth } from "../../../../middleware/checkAuth";
import { requireApprovedProgram } from "../../../../middleware/requireApprovedProgram";
import { AgentController } from "./agent.controller";

const router = Router();

// ─── Application status + dashboard ──────────────────────────────────────────
// Any authenticated account may view this: an applicant needs to see where their
// Agent application stands. Nothing program-specific is returned until the
// application is approved (all figures stay at zero).
router.get("/dashboard", checkAuth(), AgentController.getAgentDashboard);

// ─── Approved-agent-only views ───────────────────────────────────────────────
// Membership is re-derived from the persisted APPROVED application, never from the
// account's role. Every query below is scoped to the caller.
router.get(
    "/sales",
    checkAuth(),
    requireApprovedProgram("agent"),
    AgentController.getMySales,
);
router.get(
    "/earnings",
    checkAuth(),
    requireApprovedProgram("agent"),
    AgentController.getMyAgentEarnings,
);

export const AgentRoutes = router;
