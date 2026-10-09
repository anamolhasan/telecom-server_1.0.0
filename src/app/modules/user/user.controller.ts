import { Request, Response } from "express";
import status from "http-status";
import { IQueryParams } from "../../interfaces/query.interface";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { UserService } from "./user.service";

const createStaffAccount = catchAsync(async (req: Request, res: Response) => {
    const result = await UserService.createStaffAccount(req.body, req.user!);

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Staff account created successfully",
        data: result,
    });
});

const getUsers = catchAsync(async (req: Request, res: Response) => {
    const result = await UserService.getUsers(req.query as IQueryParams);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Users fetched successfully",
        data: result.data,
        meta: result.meta,
    });
});

const getUserById = catchAsync(async (req: Request, res: Response) => {
    const result = await UserService.getUserById(req.params.id as string, req.user!);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "User fetched successfully",
        data: result,
    });
});

const updateProfile = catchAsync(async (req: Request, res: Response) => {
    const result = await UserService.updateProfile(
        req.params.id as string,
        req.body,
        req.user!,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "User profile updated successfully",
        data: result,
    });
});

const updateStatus = catchAsync(async (req: Request, res: Response) => {
    const result = await UserService.updateStatus(
        req.params.id as string,
        req.body,
        req.user!,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "User status updated successfully",
        data: result,
    });
});

const changeRole = catchAsync(async (req: Request, res: Response) => {
    const result = await UserService.changeRole(
        req.params.id as string,
        req.body,
        req.user!,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "User role updated successfully",
        data: result,
    });
});

const softDeleteUser = catchAsync(async (req: Request, res: Response) => {
    const result = await UserService.softDeleteUser(req.params.id as string, req.user!);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "User deleted successfully",
        data: result,
    });
});

export const UserController = {
    createStaffAccount,
    getUsers,
    getUserById,
    updateProfile,
    updateStatus,
    changeRole,
    softDeleteUser,
};