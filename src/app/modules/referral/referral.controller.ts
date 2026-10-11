import { Request, Response } from "express";
import status from "http-status";
import { IQueryParams } from "../../interfaces/query.interface";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { ReferralService } from "./referral.service";


const applyForReferralIncome = catchAsync(async (req: Request, res: Response) => {
    const result = await ReferralService.applyForReferralIncome(req.user!, req.body);

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Referral income application submitted successfully",
        data: result,
    });
});

const getMyReferral = catchAsync(async (req: Request, res: Response) => {
    const result = await ReferralService.getMyReferral(req.user!);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Referral information fetched successfully",
        data: result,
    });
});

const getDefaultReferralCode = catchAsync(async (req: Request, res: Response) => {
    const result = await ReferralService.getDefaultReferralCode();

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Default referral code fetched successfully",
        data: result,
    });
});

const getPartnerReferral = catchAsync(async (req: Request, res: Response) => {
    const result = await ReferralService.getPartnerReferralDashboard(req.user!);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Referral partner dashboard fetched successfully",
        data: result,
    });
});

const getAllApplications = catchAsync(async (req: Request, res: Response) => {
    const result = await ReferralService.getAllApplications(req.query as IQueryParams);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Referral applications fetched successfully",
        data: result.data,
        meta: result.meta,
    });
});

const reviewApplication = catchAsync(async (req: Request, res: Response) => {
    const result = await ReferralService.reviewApplication(
        req.params.id as string,
        req.body,
        req.user!,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Referral application reviewed successfully",
        data: result,
    });
});

export const ReferralController = {
    applyForReferralIncome,
    getMyReferral,
    getDefaultReferralCode,
    getPartnerReferral,
    getAllApplications,
    reviewApplication,
};