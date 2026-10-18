import { Request, Response } from "express";
import status from "http-status";
import { IQueryParams } from "../../../interfaces/query.interface";
import { catchAsync } from "../../../shared/catchAsync";
import { sendResponse } from "../../../shared/sendResponse";
import { canViewUnpublishedCatalog } from "../catalog.access";
import type {
    ICreateProductVariantPayload,
    IUpdateProductVariantPayload,
} from "./productVariant.interface";
import {
    toPublicProductVariant,
    toPublicProductVariants,
} from "./productVariant.public";
import { ProductVariantService } from "./productVariant.service";

const createProductVariant = catchAsync(async (req: Request, res: Response) => {
    const result = await ProductVariantService.createProductVariant(
        req.body as ICreateProductVariantPayload,
    );

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Product variant created successfully",
        data: result,
    });
});

const getAllProductVariants = catchAsync(async (req: Request, res: Response) => {
    const result = await ProductVariantService.getAllProductVariants(
        req.query as IQueryParams,
        req.user?.role,
    );

    // Only content admins receive unpublished SKUs; everyone else gets the
    // explicit public projection (which also hides the reorder threshold).
    const data = canViewUnpublishedCatalog(req.user?.role)
        ? result.data
        : toPublicProductVariants(result.data);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Product variants fetched successfully",
        data,
        meta: result.meta,
    });
});

const getProductVariantById = catchAsync(async (req: Request, res: Response) => {
    const result = await ProductVariantService.getProductVariantById(
        req.params.id as string,
        req.user?.role,
    );

    const data = canViewUnpublishedCatalog(req.user?.role)
        ? result
        : toPublicProductVariant(result);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Product variant fetched successfully",
        data,
    });
});

const updateProductVariant = catchAsync(async (req: Request, res: Response) => {
    const result = await ProductVariantService.updateProductVariant(
        req.params.id as string,
        req.body as IUpdateProductVariantPayload,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Product variant updated successfully",
        data: result,
    });
});

const deleteProductVariant = catchAsync(async (req: Request, res: Response) => {
    const result = await ProductVariantService.deleteProductVariant(
        req.params.id as string,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Product variant deleted successfully",
        data: result,
    });
});

export const ProductVariantController = {
    createProductVariant,
    getAllProductVariants,
    getProductVariantById,
    updateProductVariant,
    deleteProductVariant,
};
