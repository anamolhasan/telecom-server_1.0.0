import { Router } from "express";
import { AGENT_APPLICATION_ACTORS } from "../../../../constants/rbac.constant";
import { checkAuth } from "../../../../middleware/checkAuth";
import { validateRequest } from "../../../../middleware/validateRequest";
import { AgentApplicationController } from "./agentApplication.controller";
import { AgentApplicationValidation } from "./agentApplication.validation";


const router = Router();

// Every authenticated account — SUPER_ADMIN, ADMIN, MODERATOR, SUPPORTER,
// EMPLOYEE and USER alike — may apply for and participate in the Agent program.
// System role and program membership are deliberately independent: holding a
// staff role neither grants nor blocks agent membership, which is decided only by
// reviewing the application below.
router.post(
    "/",
    checkAuth(),
    validateRequest(AgentApplicationValidation.submitAgentApplicationZodSchema),
    AgentApplicationController.submitAgentApplication,
);
router.get(
    "/me",
    checkAuth(),
    AgentApplicationController.getMyAgentApplication,
);
router.get(
    "/",
    checkAuth(...AGENT_APPLICATION_ACTORS),
    AgentApplicationController.getAllAgentApplications,
);
router.patch(
    "/:id/review",
    checkAuth(...AGENT_APPLICATION_ACTORS),
    validateRequest(AgentApplicationValidation.reviewAgentApplicationZodSchema),
    AgentApplicationController.reviewAgentApplication,
);

export const AgentApplicationRoutes = router;