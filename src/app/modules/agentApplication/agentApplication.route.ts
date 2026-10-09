import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import {
    AGENT_APPLICATION_ACTORS,
    CUSTOMER_ROLES,
} from "../../constants/rbac.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { AgentApplicationController } from "./agentApplication.controller";
import { AgentApplicationValidation } from "./agentApplication.validation";


const router = Router();

router.post(
    "/",
    checkAuth(Role.USER),
    validateRequest(AgentApplicationValidation.submitAgentApplicationZodSchema),
    AgentApplicationController.submitAgentApplication,
);
router.get(
    "/me",
    checkAuth(...CUSTOMER_ROLES),
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