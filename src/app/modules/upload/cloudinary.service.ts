import type { ImageFormat, UploadApiOptions, UploadApiResponse } from "cloudinary";
import status from "http-status";
import { cloudinary } from "../../config/cloudinary.config";
import AppError from "../../errorHelpers/AppError";

export const DEFAULT_CLOUDINARY_FOLDER = "rizqifybd/images";

const ALLOWED_IMAGE_FORMATS: ImageFormat[] = ["jpg", "png", "gif", "webp"];

export interface CloudinaryImageUploadSettings {
    folder?: string;
    publicId?: string;
}

export interface CloudinaryImageUploadResult {
    publicId: string;
    secureUrl: string;
    format: string;
    resourceType: string;
    width: number;
    height: number;
    bytes: number;
    createdAt: string;
}

export interface CloudinaryDeleteResult {
    publicId: string;
    result: string;
}

// Guards against callers smuggling a remote URL or filesystem path where an
// asset path (folder / public_id) is expected. Real Cloudinary public_ids may
// contain forward slashes, so those are allowed while traversal, drive letters,
// URL schemes and leading separators are rejected.
const assertSafeAssetPath = (value: string, field: string): string => {
    const normalized = typeof value === "string" ? value.trim() : "";

    const isUnsafe =
        normalized.length === 0 ||
        /^[a-z][a-z0-9+.-]*:\/\//i.test(normalized) ||
        normalized.includes("..") ||
        normalized.includes("\\") ||
        normalized.startsWith("/") ||
        /^[a-zA-Z]:/.test(normalized);

    if (isUnsafe) {
        throw new AppError(status.BAD_REQUEST, `Invalid ${field}.`);
    }

    return normalized;
};

export const uploadImageBuffer = async (
    buffer: Buffer,
    settings: CloudinaryImageUploadSettings = {},
): Promise<CloudinaryImageUploadResult> => {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new AppError(status.BAD_REQUEST, "A non-empty image buffer is required.");
    }

    const folder = settings.folder
        ? assertSafeAssetPath(settings.folder, "upload folder")
        : DEFAULT_CLOUDINARY_FOLDER;

    const uploadOptions: UploadApiOptions = {
        resource_type: "image",
        folder,
        allowed_formats: ALLOWED_IMAGE_FORMATS,
        unique_filename: true,
        overwrite: false,
        invalidate: false,
    };

    if (settings.publicId) {
        uploadOptions.public_id = assertSafeAssetPath(settings.publicId, "public id");
    }

    try {
        const result = await new Promise<UploadApiResponse>((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(uploadOptions, (error, uploadResult) => {
                if (error || !uploadResult) {
                    reject(error ?? new Error("Cloudinary returned no upload result"));
                    return;
                }

                resolve(uploadResult);
            });

            stream.end(buffer);
        });

        return {
            publicId: result.public_id,
            secureUrl: result.secure_url,
            format: result.format,
            resourceType: result.resource_type,
            width: result.width,
            height: result.height,
            bytes: result.bytes,
            createdAt: result.created_at,
        };
    } catch {
        throw new AppError(
            status.BAD_GATEWAY,
            "Image upload failed. Please try again later.",
        );
    }
};

export const deleteImageByPublicId = async (
    publicId: string,
): Promise<CloudinaryDeleteResult> => {
    const safePublicId = assertSafeAssetPath(publicId, "public id");

    try {
        const response = await cloudinary.uploader.destroy(safePublicId, {
            resource_type: "image",
            invalidate: true,
        });

        const result =
            response && typeof response.result === "string"
                ? response.result
                : "not found";

        return { publicId: safePublicId, result };
    } catch {
        throw new AppError(
            status.BAD_GATEWAY,
            "Image deletion failed. Please try again later.",
        );
    }
};
