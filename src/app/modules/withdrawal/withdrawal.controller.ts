import { Request, Response } from "express";
import status from "http-status";
import { IQueryParams } from "../../interfaces/query.interface";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { WithdrawalService } from "./withdrawal.service";


const requestWithdrawal = catchAsync(async (req: Request, res: Response) => {
    const result = await WithdrawalService.requestWithdrawal(req.body, req.user!);

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Withdrawal request submitted successfully",
        data: result,
    });
});

const getMyWithdrawals = catchAsync(async (req: Request, res: Response) => {
    const result = await WithdrawalService.getMyWithdrawals(req.user!, req.query as IQueryParams);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Withdrawals fetched successfully",
        data: result.data,
        meta: result.meta,
    });
});

const getAllWithdrawals = catchAsync(async (req: Request, res: Response) => {
    const result = await WithdrawalService.getAllWithdrawals(req.query as IQueryParams);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Withdrawals fetched successfully",
        data: result.data,
        meta: result.meta,
    });
});

const updateWithdrawalStatus = catchAsync(async (req: Request, res: Response) => {
    const result = await WithdrawalService.updateWithdrawalStatus(
        req.params.id as string,
        req.body,
        req.user!,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Withdrawal status updated successfully",
        data: result,
    });
});

export const WithdrawalController = {
    requestWithdrawal,
    getMyWithdrawals,
    getAllWithdrawals,
    updateWithdrawalStatus,
};
