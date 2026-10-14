import { Request, Response } from "express";
import status from "http-status";
import { IQueryParams } from "../../interfaces/query.interface";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import type {
    ICreateOperatorOfferPayload,
    IUpdateOperatorOfferPayload,
    OperatorOfferStatusAction,
} from "./operatorOffer.interface";
import { OperatorOfferService } from "./operatorOffer.service";

const createOperatorOffer = catchAsync(async (req: Request, res: Response) => {
    const result = await OperatorOfferService.createOperatorOffer(
        req.body as ICreateOperatorOfferPayload,
    );

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Operator offer created successfully",
        data: result,
    });
});

const getAllOperatorOffers = catchAsync(async (req: Request, res: Response) => {
    const result = await OperatorOfferService.getAllOperatorOffers(
        req.query as IQueryParams,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Operator offers fetched successfully",
        data: result.data,
        meta: result.meta,
    });
});

const getOperatorOfferById = catchAsync(async (req: Request, res: Response) => {
    const result = await OperatorOfferService.getOperatorOfferById(
        req.params.id as string,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Operator offer fetched successfully",
        data: result,
    });
});

const updateOperatorOffer = catchAsync(async (req: Request, res: Response) => {
    const result = await OperatorOfferService.updateOperatorOffer(
        req.params.id as string,
        req.body as IUpdateOperatorOfferPayload,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Operator offer updated successfully",
        data: result,
    });
});

const changeOperatorOfferStatus = catchAsync(
    async (req: Request, res: Response) => {
        const { action } = req.body as { action: OperatorOfferStatusAction };
        const result = await OperatorOfferService.changeOperatorOfferStatus(
            req.params.id as string,
            action,
        );

        sendResponse(res, {
            httpStatusCode: status.OK,
            success: true,
            message: `Operator offer ${action}d successfully`,
            data: result,
        });
    },
);

const archiveOperatorOffer = catchAsync(async (req: Request, res: Response) => {
    const result = await OperatorOfferService.archiveOperatorOffer(
        req.params.id as string,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Operator offer archived successfully",
        data: result,
    });
});

export const OperatorOfferController = {
    createOperatorOffer,
    getAllOperatorOffers,
    getOperatorOfferById,
    updateOperatorOffer,
    changeOperatorOfferStatus,
    archiveOperatorOffer,
};
