import { Request, Response } from "express";
import status from "http-status";
import type { IQueryParams } from "../../../interfaces/query.interface";
import { catchAsync } from "../../../shared/catchAsync";
import { sendResponse } from "../../../shared/sendResponse";
import type {
    ICheckoutPayload,
    IUpdateProductOrderPaymentPayload,
    IUpdateProductOrderStatusPayload,
} from "./productOrder.interface";
import { ProductOrderService } from "./productOrder.service";

// Every customer handler derives the order from `req.user`; an order id is never
// trusted on its own, so one user cannot reach another user's order.

const checkout = catchAsync(async (req: Request, res: Response) => {
    const result = await ProductOrderService.checkout(
        req.user,
        req.body as ICheckoutPayload,
    );

    sendResponse(res, {
        // A replay of an already-placed order returns the same order with 200
        // instead of 201, so a retrying client can tell the two apart.
        httpStatusCode: result.idempotent ? status.OK : status.CREATED,
        success: true,
        message: result.idempotent
            ? "Order was already placed"
            : "Order placed successfully",
        data: result.order,
    });
});

const getMyOrders = catchAsync(async (req: Request, res: Response) => {
    const result = await ProductOrderService.getMyOrders(
        req.user,
        req.query as IQueryParams,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Orders fetched successfully",
        data: result.data,
        meta: result.meta,
    });
});

const getMyOrder = catchAsync(async (req: Request, res: Response) => {
    const result = await ProductOrderService.getMyOrder(
        req.user,
        req.params.id as string,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Order fetched successfully",
        data: result,
    });
});

const getAllProductOrders = catchAsync(async (req: Request, res: Response) => {
    const result = await ProductOrderService.getAllProductOrders(
        req.query as IQueryParams,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Product orders fetched successfully",
        data: result.data,
        meta: result.meta,
    });
});

const getProductOrderById = catchAsync(async (req: Request, res: Response) => {
    const result = await ProductOrderService.getProductOrderById(
        req.params.id as string,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Product order fetched successfully",
        data: result,
    });
});

const updateOrderStatus = catchAsync(async (req: Request, res: Response) => {
    const payload = req.body as IUpdateProductOrderStatusPayload;

    const result = await ProductOrderService.updateOrderStatus(
        req.params.id as string,
        payload.status,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Order status updated successfully",
        data: result,
    });
});

const updateOrderPayment = catchAsync(async (req: Request, res: Response) => {
    const payload = req.body as IUpdateProductOrderPaymentPayload;

    const result = await ProductOrderService.updateOrderPayment(
        req.params.id as string,
        payload.paymentStatus,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Order payment status updated successfully",
        data: result,
    });
});

export const ProductOrderController = {
    checkout,
    getMyOrders,
    getMyOrder,
    getAllProductOrders,
    getProductOrderById,
    updateOrderStatus,
    updateOrderPayment,
};
