import { Request, Response } from "express";
import status from "http-status";
import type { IQueryParams } from "../../interfaces/query.interface";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import type {
    ICommissionRulePayload,
    IUpdateCommissionRulePayload,
} from "./earning.interface";
import { EarningService } from "./earning.service";

const getMyEarnings = catchAsync(async (req: Request, res: Response) => {
    const result = await EarningService.getMyEarnings(
        req.user,
        req.query as IQueryParams,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Earnings fetched successfully",
        data: result.data,
        meta: result.meta,
    });
});

const getMyEarningSummary = catchAsync(async (req: Request, res: Response) => {
    const result = await EarningService.getMyEarningSummary(req.user);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Earning summary fetched successfully",
        data: result,
    });
});

const createCommissionRule = catchAsync(async (req: Request, res: Response) => {
    const result = await EarningService.createCommissionRule(
        req.user,
        req.body as ICommissionRulePayload,
    );

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Commission rule created successfully",
        data: result,
    });
});

const listCommissionRules = catchAsync(async (req: Request, res: Response) => {
    const result = await EarningService.listCommissionRules(
        req.query as IQueryParams,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Commission rules fetched successfully",
        data: result.data,
        meta: result.meta,
    });
});

const updateCommissionRule = catchAsync(async (req: Request, res: Response) => {
    const result = await EarningService.updateCommissionRule(
        req.params.id as string,
        req.body as IUpdateCommissionRulePayload,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Commission rule updated successfully",
        data: result,
    });
});

export const EarningController = {
    getMyEarnings,
    getMyEarningSummary,
    createCommissionRule,
    listCommissionRules,
    updateCommissionRule,
};
