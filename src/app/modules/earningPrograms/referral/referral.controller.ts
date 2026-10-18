import { Request, Response } from "express";
import status from "http-status";
import { EarningProgram } from "../../../../generated/prisma/enums";
import { IQueryParams } from "../../../interfaces/query.interface";
import { catchAsync } from "../../../shared/catchAsync";
import { sendResponse } from "../../../shared/sendResponse";
import { EarningService } from "../../earning/earning.service";
import { ReferralService } from "./referral.service";
import { ReferralApplicationService } from "./referralApplication/referralApplication.service";


const applyForReferralIncome = catchAsync(async (req: Request, res: Response) => {
    const result = await ReferralApplicationService.applyForReferralIncome(req.user!, req.body);

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Referral income application submitted successfully",
        data: result,
    });
});

const getMyReferral = catchAsync(async (req: Request, res: Response) => {
    const result = await ReferralApplicationService.getMyReferral(req.user!);

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
    const result = await ReferralApplicationService.getAllApplications(req.query as IQueryParams);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Referral applications fetched successfully",
        data: result.data,
        meta: result.meta,
    });
});

const reviewApplication = catchAsync(async (req: Request, res: Response) => {
    const result = await ReferralApplicationService.reviewApplication(
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

const getMyMilestone = catchAsync(async (req: Request, res: Response) => {
    const result = await ReferralService.getMyMilestone(req.user!);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Referral milestone status fetched successfully",
        data: result,
    });
});

const getMyReferralEarnings = catchAsync(async (req: Request, res: Response) => {
    const result = await EarningService.getMyEarnings(
        req.user!,
        req.query as IQueryParams,
        { program: EarningProgram.REFERRAL },
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Referral earnings fetched successfully",
        data: result.data,
        meta: result.meta,
    });
});

export const ReferralController = {
    applyForReferralIncome,
    getMyReferral,
    getDefaultReferralCode,
    getPartnerReferral,
    getAllApplications,
    reviewApplication,
    getMyMilestone,
    getMyReferralEarnings,
};