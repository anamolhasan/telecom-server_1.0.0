import { Request, Response } from "express";
import status from "http-status";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { SettingService } from "./setting.service";


const getDefaultReferralSetting = catchAsync(async (req: Request, res: Response) => {
    const result = await SettingService.getDefaultReferralSetting();

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Default referral setting fetched successfully",
        data: result,
    });
});

const updateDefaultReferralSetting = catchAsync(async (req: Request, res: Response) => {
    const result = await SettingService.updateDefaultReferralSetting(req.body, req.user!);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Default referral setting updated successfully",
        data: result,
    });
});

export const SettingController = {
    getDefaultReferralSetting,
    updateDefaultReferralSetting,
};