import { Request, Response } from "express";
import status from "http-status";
import { catchAsync } from "../../../shared/catchAsync";
import { sendResponse } from "../../../shared/sendResponse";
import { IQueryParams } from "../../../interfaces/query.interface";
import { OperatorService } from "./operator.service";


const createOperator = catchAsync(async (req: Request, res: Response) => {
    const result = await OperatorService.createOperator(req.body);

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Operator created successfully",
        data: result,
    });
});

const getAllOperators = catchAsync(async (req: Request, res: Response) => {
    const result = await OperatorService.getAllOperators(req.query as IQueryParams);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Operators fetched successfully",
        data: result.data,
        meta: result.meta,
    });
});

const getOperatorById = catchAsync(async (req: Request, res: Response) => {
    const result = await OperatorService.getOperatorById(req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Operator fetched successfully",
        data: result,
    });
});

const updateOperator = catchAsync(async (req: Request, res: Response) => {
    const result = await OperatorService.updateOperator(req.params.id as string, req.body);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Operator updated successfully",
        data: result,
    });
});

const deleteOperator = catchAsync(async (req: Request, res: Response) => {
    const result = await OperatorService.deleteOperator(req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Operator deleted successfully",
        data: result,
    });
});

export const OperatorController = {
    createOperator,
    getAllOperators,
    getOperatorById,
    updateOperator,
    deleteOperator,
};
