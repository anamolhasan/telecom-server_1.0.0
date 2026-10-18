import { Request, Response } from "express";
import status from "http-status";
import { EarningProgram } from "../../../../../generated/prisma/enums";
import type { IQueryParams } from "../../../../interfaces/query.interface";
import { catchAsync } from "../../../../shared/catchAsync";
import { sendResponse } from "../../../../shared/sendResponse";
import { EarningService } from "../../../earning/earning.service";
import { AgentService } from "./agent.service";

// The dashboard is readable by any authenticated account so a pending applicant
// can see their application state; the figures simply stay at zero until the
// Agent program is approved.
const getAgentDashboard = catchAsync(async (req: Request, res: Response) => {
    const result = await AgentService.getAgentDashboard(req.user);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Agent dashboard fetched successfully",
        data: result,
    });
});

const getMySales = catchAsync(async (req: Request, res: Response) => {
    const result = await AgentService.getMySales(
        req.user,
        req.query as IQueryParams,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Agent sales fetched successfully",
        data: result.data,
        meta: result.meta,
    });
});

// The Agent program's own earning history. Reuses the shared ledger, but the
// program is forced server-side so this endpoint can never return another
// program's earnings.
const getMyAgentEarnings = catchAsync(async (req: Request, res: Response) => {
    const result = await EarningService.getMyEarnings(
        req.user,
        req.query as IQueryParams,
        { program: EarningProgram.AGENT },
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Agent earnings fetched successfully",
        data: result.data,
        meta: result.meta,
    });
});

export const AgentController = {
    getAgentDashboard,
    getMySales,
    getMyAgentEarnings,
};
