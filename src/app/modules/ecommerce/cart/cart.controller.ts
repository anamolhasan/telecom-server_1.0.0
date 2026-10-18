import { Request, Response } from "express";
import status from "http-status";
import { catchAsync } from "../../../shared/catchAsync";
import { sendResponse } from "../../../shared/sendResponse";
import type {
    IAddCartItemPayload,
    IUpdateCartItemPayload,
} from "./cart.interface";
import { CartService } from "./cart.service";

// Every cart handler derives the cart from `req.user`; a cart id is never taken
// from the request, so one user cannot reach another user's cart.

const getMyCart = catchAsync(async (req: Request, res: Response) => {
    const result = await CartService.getCart(req.user);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Cart fetched successfully",
        data: result,
    });
});

const addCartItem = catchAsync(async (req: Request, res: Response) => {
    const result = await CartService.addCartItem(
        req.user,
        req.body as IAddCartItemPayload,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Item added to cart successfully",
        data: result,
    });
});

const updateCartItem = catchAsync(async (req: Request, res: Response) => {
    const result = await CartService.updateCartItemQuantity(
        req.user,
        req.params.itemId as string,
        req.body as IUpdateCartItemPayload,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Cart item updated successfully",
        data: result,
    });
});

const removeCartItem = catchAsync(async (req: Request, res: Response) => {
    const result = await CartService.removeCartItem(
        req.user,
        req.params.itemId as string,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Cart item removed successfully",
        data: result,
    });
});

const clearCart = catchAsync(async (req: Request, res: Response) => {
    const result = await CartService.clearCart(req.user);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Cart cleared successfully",
        data: result,
    });
});

export const CartController = {
    getMyCart,
    addCartItem,
    updateCartItem,
    removeCartItem,
    clearCart,
};
