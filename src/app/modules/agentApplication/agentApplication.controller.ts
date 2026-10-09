import { Request, Response } from "express";
import status from "http-status";
import { IQueryParams } from "../../interfaces/query.interface";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { AgentApplicationService } from "./agentApplication.service";


const submitAgentApplication = catchAsync(async (req: Request, res: Response) => {
    const result = await AgentApplicationService.submitAgentApplication(req.user!, req.body);

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Agent application submitted successfully",
        data: result,
    });
});

const getMyAgentApplication = catchAsync(async (req: Request, res: Response) => {
    const result = await AgentApplicationService.getMyAgentApplication(req.user!);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Agent application fetched successfully",
        data: result,
    });
});

const getAllAgentApplications = catchAsync(async (req: Request, res: Response) => {
    const result = await AgentApplicationService.getAllAgentApplications(
        req.query as IQueryParams,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Agent applications fetched successfully",
        data: result.data,
        meta: result.meta,
    });
});

const reviewAgentApplication = catchAsync(async (req: Request, res: Response) => {
    const result = await AgentApplicationService.reviewAgentApplication(
        req.params.id as string,
        req.body,
        req.user!,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Agent application reviewed successfully",
        data: result,
    });
});

export const AgentApplicationController = {
    submitAgentApplication,
    getMyAgentApplication,
    getAllAgentApplications,
    reviewAgentApplication,
};