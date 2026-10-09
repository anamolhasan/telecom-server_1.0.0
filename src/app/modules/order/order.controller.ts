import { Request, Response } from "express";
import status from "http-status";
import { IQueryParams } from "../../interfaces/query.interface";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { OrderService } from "./order.service";


const createOrder = catchAsync(async (req: Request, res: Response) => {
    const result = await OrderService.createOrder(req.body, req.user!);

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Order created successfully",
        data: result,
    });
});

const initiatePayment = catchAsync(async (req: Request, res: Response) => {
    const result = await OrderService.initiatePayment(req.params.id as string, req.user!);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Payment session created successfully",
        data: result,
    });
});

const getMyOrders = catchAsync(async (req: Request, res: Response) => {
    const result = await OrderService.getMyOrders(req.user!, req.query as IQueryParams);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Orders fetched successfully",
        data: result.data,
        meta: result.meta,
    });
});

const getMyOrder = catchAsync(async (req: Request, res: Response) => {
    const result = await OrderService.getMyOrder(req.params.id as string, req.user!);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Order fetched successfully",
        data: result,
    });
});

const getAllOrders = catchAsync(async (req: Request, res: Response) => {
    const result = await OrderService.getAllOrders(req.query as IQueryParams);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Orders fetched successfully",
        data: result.data,
        meta: result.meta,
    });
});

const changeOrderStatus = catchAsync(async (req: Request, res: Response) => {
    const result = await OrderService.changeOrderStatus(req.params.id as string, req.body.status);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Order status updated successfully",
        data: result,
    });
});

export const OrderController = {
    createOrder,
    initiatePayment,
    getMyOrders,
    getMyOrder,
    getAllOrders,
    changeOrderStatus,
};
