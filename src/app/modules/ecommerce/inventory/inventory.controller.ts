import { Request, Response } from "express";
import status from "http-status";
import { IQueryParams } from "../../../interfaces/query.interface";
import { catchAsync } from "../../../shared/catchAsync";
import { sendResponse } from "../../../shared/sendResponse";
import type {
    IAdjustInventoryPayload,
    ISetInventoryPayload,
} from "./inventory.interface";
import { InventoryService } from "./inventory.service";

const getAllInventory = catchAsync(async (req: Request, res: Response) => {
    const result = await InventoryService.getAllInventory(
        req.query as IQueryParams,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Inventory fetched successfully",
        data: result.data,
        meta: result.meta,
    });
});

const getInventoryByVariantId = catchAsync(
    async (req: Request, res: Response) => {
        const result = await InventoryService.getInventoryByVariantId(
            req.params.variantId as string,
        );

        sendResponse(res, {
            httpStatusCode: status.OK,
            success: true,
            message: "Inventory fetched successfully",
            data: result,
        });
    },
);

const setInventory = catchAsync(async (req: Request, res: Response) => {
    const result = await InventoryService.setInventory(
        req.params.variantId as string,
        req.body as ISetInventoryPayload,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Inventory updated successfully",
        data: result,
    });
});

const adjustInventory = catchAsync(async (req: Request, res: Response) => {
    const result = await InventoryService.adjustInventory(
        req.params.variantId as string,
        req.body as IAdjustInventoryPayload,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Inventory adjusted successfully",
        data: result,
    });
});

export const InventoryController = {
    getAllInventory,
    getInventoryByVariantId,
    setInventory,
    adjustInventory,
};
