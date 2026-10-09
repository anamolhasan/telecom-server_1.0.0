import { AgentApplicationStatus } from "../../../generated/prisma/enums";

export interface ISubmitAgentApplicationPayload {
    reason?: string;
}

export interface IReviewAgentApplicationPayload {
    status: AgentApplicationStatus;
    rejectionReason?: string;
}