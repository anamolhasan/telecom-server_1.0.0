import { Request, Response } from "express";
import status from "http-status";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { RoleAccessService } from "./roleAccess.service";

const getRoleAccess = catchAsync(async (_req: Request, res: Response) => {
    const result = RoleAccessService.getRoleAccessMatrix();

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Role access matrix fetched successfully",
        data: result,
    });
});

export const RoleAccessController = {
    getRoleAccess,
};
