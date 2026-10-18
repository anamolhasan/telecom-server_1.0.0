import { Request, Response } from "express";
import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { uploadImageBuffer } from "./cloudinary.service";

const uploadImage = catchAsync(async (req: Request, res: Response) => {
    const file = req.file;

    if (!file || !file.buffer || file.buffer.length === 0) {
        throw new AppError(status.BAD_REQUEST, "An image file is required.");
    }

    const result = await uploadImageBuffer(file.buffer);

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Image uploaded successfully",
        data: {
            secureUrl: result.secureUrl,
            publicId: result.publicId,
            format: result.format,
            width: result.width,
            height: result.height,
        },
    });
});

export const UploadController = {
    uploadImage,
};
