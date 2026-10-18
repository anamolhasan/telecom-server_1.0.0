import { Request, Response } from "express";
import status from "http-status";
import { IQueryParams } from "../../../../interfaces/query.interface";
import { catchAsync } from "../../../../shared/catchAsync";
import { sendResponse } from "../../../../shared/sendResponse";
import { AffiliateApplicationService } from "./affiliateApplication.service";


const submitAffiliateApplication = catchAsync(async (req: Request, res: Response) => {
    const result = await AffiliateApplicationService.submitAffiliateApplication(
        req.user!,
        req.body,
    );

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Affiliate application submitted successfully",
        data: result,
    });
});

const getMyAffiliateApplication = catchAsync(async (req: Request, res: Response) => {
    const result = await AffiliateApplicationService.getMyAffiliateApplication(req.user!);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Affiliate application fetched successfully",
        data: result,
    });
});

const getAllAffiliateApplications = catchAsync(async (req: Request, res: Response) => {
    const result = await AffiliateApplicationService.getAllAffiliateApplications(
        req.query as IQueryParams,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Affiliate applications fetched successfully",
        data: result.data,
        meta: result.meta,
    });
});

const reviewAffiliateApplication = catchAsync(async (req: Request, res: Response) => {
    const result = await AffiliateApplicationService.reviewAffiliateApplication(
        req.params.id as string,
        req.body,
        req.user!,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Affiliate application reviewed successfully",
        data: result,
    });
});

export const AffiliateApplicationController = {
    submitAffiliateApplication,
    getMyAffiliateApplication,
    getAllAffiliateApplications,
    reviewAffiliateApplication,
};
