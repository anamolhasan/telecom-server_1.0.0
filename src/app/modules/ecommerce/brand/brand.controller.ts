import { Request, Response } from "express";
import status from "http-status";
import { IQueryParams } from "../../../interfaces/query.interface";
import { catchAsync } from "../../../shared/catchAsync";
import { sendResponse } from "../../../shared/sendResponse";
import { canViewUnpublishedCatalog } from "../catalog.access";
import type { ICreateBrandPayload, IUpdateBrandPayload } from "./brand.interface";
import { toPublicBrand, toPublicBrands } from "./brand.public";
import { BrandService } from "./brand.service";

const createBrand = catchAsync(async (req: Request, res: Response) => {
    const result = await BrandService.createBrand(
        req.body as ICreateBrandPayload,
    );

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Brand created successfully",
        data: result,
    });
});

const getAllBrands = catchAsync(async (req: Request, res: Response) => {
    const result = await BrandService.getAllBrands(
        req.query as IQueryParams,
        req.user?.role,
    );

    const data = canViewUnpublishedCatalog(req.user?.role)
        ? result.data
        : toPublicBrands(result.data);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Brands fetched successfully",
        data,
        meta: result.meta,
    });
});

const getBrandById = catchAsync(async (req: Request, res: Response) => {
    const result = await BrandService.getBrandById(
        req.params.id as string,
        req.user?.role,
    );

    const data = canViewUnpublishedCatalog(req.user?.role)
        ? result
        : toPublicBrand(result);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Brand fetched successfully",
        data,
    });
});

const updateBrand = catchAsync(async (req: Request, res: Response) => {
    const result = await BrandService.updateBrand(
        req.params.id as string,
        req.body as IUpdateBrandPayload,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Brand updated successfully",
        data: result,
    });
});

const deleteBrand = catchAsync(async (req: Request, res: Response) => {
    const result = await BrandService.deleteBrand(req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Brand deleted successfully",
        data: result,
    });
});

export const BrandController = {
    createBrand,
    getAllBrands,
    getBrandById,
    updateBrand,
    deleteBrand,
};
