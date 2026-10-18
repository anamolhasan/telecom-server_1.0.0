import { Request, Response } from "express";
import status from "http-status";
import { IQueryParams } from "../../../interfaces/query.interface";
import { catchAsync } from "../../../shared/catchAsync";
import { sendResponse } from "../../../shared/sendResponse";
import { canViewUnpublishedCatalog } from "../catalog.access";
import type {
    ICreateProductPayload,
    IUpdateProductPayload,
} from "./product.interface";
import { toPublicProduct, toPublicProducts } from "./product.public";
import { ProductService } from "./product.service";

const createProduct = catchAsync(async (req: Request, res: Response) => {
    const result = await ProductService.createProduct(
        req.body as ICreateProductPayload,
    );

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Product created successfully",
        data: result,
    });
});

const getAllProducts = catchAsync(async (req: Request, res: Response) => {
    const result = await ProductService.getAllProducts(
        req.query as IQueryParams,
        req.user?.role,
    );

    // Only content admins receive drafts/archived rows; everyone else gets the
    // explicit public projection (which also hides isDeleted/deletedAt and the
    // inactive variants of a published product).
    const data = canViewUnpublishedCatalog(req.user?.role)
        ? result.data
        : toPublicProducts(result.data);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Products fetched successfully",
        data,
        meta: result.meta,
    });
});

const getProductById = catchAsync(async (req: Request, res: Response) => {
    const result = await ProductService.getProductById(
        req.params.id as string,
        req.user?.role,
    );

    const data = canViewUnpublishedCatalog(req.user?.role)
        ? result
        : toPublicProduct(result);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Product fetched successfully",
        data,
    });
});

const updateProduct = catchAsync(async (req: Request, res: Response) => {
    const result = await ProductService.updateProduct(
        req.params.id as string,
        req.body as IUpdateProductPayload,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Product updated successfully",
        data: result,
    });
});

const deleteProduct = catchAsync(async (req: Request, res: Response) => {
    const result = await ProductService.deleteProduct(req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Product deleted successfully",
        data: result,
    });
});

export const ProductController = {
    createProduct,
    getAllProducts,
    getProductById,
    updateProduct,
    deleteProduct,
};
