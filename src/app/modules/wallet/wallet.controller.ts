import { Request, Response } from "express";
import status from "http-status";
import { IQueryParams } from "../../interfaces/query.interface";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { WalletService } from "./wallet.service";


const getMyWallet = catchAsync(async (req: Request, res: Response) => {
    const result = await WalletService.getMyWallet(req.user!);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Wallet fetched successfully",
        data: result,
    });
});

const getMyWalletTransactions = catchAsync(async (req: Request, res: Response) => {
    const result = await WalletService.getMyWalletTransactions(req.user!, req.query as IQueryParams);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Wallet transactions fetched successfully",
        data: result.data,
        meta: result.meta,
    });
});

const adjustWallet = catchAsync(async (req: Request, res: Response) => {
    const result = await WalletService.adjustWallet(req.body);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Wallet adjusted successfully",
        data: result,
    });
});

export const WalletController = {
    getMyWallet,
    getMyWalletTransactions,
    adjustWallet,
};
