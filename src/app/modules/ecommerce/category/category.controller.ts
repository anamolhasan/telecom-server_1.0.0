import { Request, Response } from "express";
import status from "http-status";
import { IQueryParams } from "../../../interfaces/query.interface";
import { catchAsync } from "../../../shared/catchAsync";
import { sendResponse } from "../../../shared/sendResponse";
import { canViewUnpublishedCatalog } from "../catalog.access";
import type { ICreateCategoryPayload, IUpdateCategoryPayload } from "./category.interface";
import { toPublicCategories, toPublicCategory } from "./category.public";
import { CategoryService } from "./category.service";

const createCategory = catchAsync(async (req: Request, res: Response) => {
    const result = await CategoryService.createCategory(
        req.body as ICreateCategoryPayload,
    );

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Category created successfully",
        data: result,
    });
});

const getAllCategories = catchAsync(async (req: Request, res: Response) => {
    const result = await CategoryService.getAllCategories(
        req.query as IQueryParams,
        req.user?.role,
    );

    // Only content admins receive unpublished rows; everyone else gets the
    // explicit public projection (which also hides isDeleted/deletedAt).
    const data = canViewUnpublishedCatalog(req.user?.role)
        ? result.data
        : toPublicCategories(result.data);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Categories fetched successfully",
        data,
        meta: result.meta,
    });
});

const getCategoryById = catchAsync(async (req: Request, res: Response) => {
    const result = await CategoryService.getCategoryById(
        req.params.id as string,
        req.user?.role,
    );

    const data = canViewUnpublishedCatalog(req.user?.role)
        ? result
        : toPublicCategory(result);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Category fetched successfully",
        data,
    });
});

const updateCategory = catchAsync(async (req: Request, res: Response) => {
    const result = await CategoryService.updateCategory(
        req.params.id as string,
        req.body as IUpdateCategoryPayload,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Category updated successfully",
        data: result,
    });
});

const deleteCategory = catchAsync(async (req: Request, res: Response) => {
    const result = await CategoryService.deleteCategory(
        req.params.id as string,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Category deleted successfully",
        data: result,
    });
});

export const CategoryController = {
    createCategory,
    getAllCategories,
    getCategoryById,
    updateCategory,
    deleteCategory,
};
