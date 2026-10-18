import { extname } from "node:path";
import { NextFunction, Request, RequestHandler, Response } from "express";
import multer from "multer";
import status from "http-status";
import AppError from "../errorHelpers/AppError";

export const DEFAULT_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
export const DEFAULT_MAX_FILE_COUNT = 5;

export const ALLOWED_IMAGE_MIME_TYPES = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
] as const;

const ALLOWED_IMAGE_MIME_TYPE_SET = new Set<string>(ALLOWED_IMAGE_MIME_TYPES);

const ALLOWED_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface ImageUploadOptions {
    maxFileSizeBytes?: number;
    maxFileCount?: number;
}

// The client-declared MIME type is untrusted. The real format is derived from
// the file header (magic bytes) so a renamed executable cannot masquerade as an
// image. SVG is intentionally unsupported: it is scriptable XML and a stored
// XSS vector when served inline.
export const sniffImageMimeType = (buffer: Buffer): string | null => {
    if (!buffer || buffer.length === 0) {
        return null;
    }

    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return "image/jpeg";
    }

    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
        return "image/png";
    }

    if (buffer.length >= 6) {
        const header = buffer.subarray(0, 6).toString("ascii");
        if (header === "GIF87a" || header === "GIF89a") {
            return "image/gif";
        }
    }

    if (
        buffer.length >= 12 &&
        buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
        buffer.subarray(8, 12).toString("ascii") === "WEBP"
    ) {
        return "image/webp";
    }

    return null;
};

const collectUploadedFiles = (req: Request): Express.Multer.File[] => {
    const files: Express.Multer.File[] = [];

    if (req.file) {
        files.push(req.file);
    }

    const multi = req.files;

    if (Array.isArray(multi)) {
        files.push(...multi);
    } else if (multi && typeof multi === "object") {
        for (const group of Object.values(multi)) {
            if (Array.isArray(group)) {
                files.push(...group);
            }
        }
    }

    return files;
};

const imageFileFilter: multer.Options["fileFilter"] = (_req, file, callback) => {
    const declaredMime = (file.mimetype || "").toLowerCase();
    const extension = extname(file.originalname || "").toLowerCase();

    if (!ALLOWED_IMAGE_MIME_TYPE_SET.has(declaredMime)) {
        callback(
            new AppError(
                status.UNSUPPORTED_MEDIA_TYPE,
                `Unsupported file type. Allowed types: ${ALLOWED_IMAGE_MIME_TYPES.join(", ")}.`,
            ),
        );
        return;
    }

    if (!ALLOWED_IMAGE_EXTENSIONS.has(extension)) {
        callback(
            new AppError(
                status.UNSUPPORTED_MEDIA_TYPE,
                `Unsupported file extension. Allowed extensions: ${[...ALLOWED_IMAGE_EXTENSIONS].join(", ")}.`,
            ),
        );
        return;
    }

    callback(null, true);
};

export const normalizeMulterError = (error: unknown): Error => {
    if (error instanceof AppError) {
        return error;
    }

    if (error instanceof multer.MulterError) {
        switch (error.code) {
            case "LIMIT_FILE_SIZE":
                return new AppError(
                    status.REQUEST_ENTITY_TOO_LARGE,
                    "Uploaded file exceeds the maximum allowed size.",
                );
            case "LIMIT_FILE_COUNT":
            case "LIMIT_PART_COUNT":
            case "LIMIT_UNEXPECTED_FILE":
                return new AppError(
                    status.BAD_REQUEST,
                    "Unexpected file field or too many files uploaded.",
                );
            case "LIMIT_FIELD_KEY":
            case "LIMIT_FIELD_VALUE":
            case "LIMIT_FIELD_COUNT":
                return new AppError(status.BAD_REQUEST, "Invalid multipart form data.");
            case "MISSING_FIELD_NAME":
                return new AppError(status.BAD_REQUEST, "A file field is missing its name.");
            default:
                return new AppError(status.BAD_REQUEST, "File upload failed.");
        }
    }

    if (error instanceof Error) {
        return new AppError(status.BAD_REQUEST, "File upload failed.");
    }

    return new AppError(status.BAD_REQUEST, "File upload failed.");
};

const wrapMulter = (handler: RequestHandler): RequestHandler => {
    return (req: Request, res: Response, next: NextFunction) => {
        handler(req, res, (error?: unknown) => {
            if (error) {
                next(normalizeMulterError(error));
                return;
            }

            next();
        });
    };
};

const buildMulterUpload = (options: ImageUploadOptions): multer.Multer =>
    multer({
        storage: multer.memoryStorage(),
        limits: {
            fileSize: options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES,
            files: options.maxFileCount ?? 1,
        },
        fileFilter: imageFileFilter,
    });

export const validateUploadedImageContent: RequestHandler = (
    req: Request,
    _res: Response,
    next: NextFunction,
) => {
    for (const file of collectUploadedFiles(req)) {
        if (!file.buffer || file.buffer.length === 0) {
            next(new AppError(status.BAD_REQUEST, "Uploaded file is empty."));
            return;
        }

        const sniffedMime = sniffImageMimeType(file.buffer);

        if (!sniffedMime) {
            next(
                new AppError(
                    status.UNSUPPORTED_MEDIA_TYPE,
                    "File content is not a supported image.",
                ),
            );
            return;
        }

        const declaredMime = (file.mimetype || "").toLowerCase();

        if (declaredMime && declaredMime !== sniffedMime) {
            next(
                new AppError(
                    status.UNSUPPORTED_MEDIA_TYPE,
                    "File type does not match its content.",
                ),
            );
            return;
        }
    }

    next();
};

export const uploadSingleImage = (
    fieldName = "file",
    options: ImageUploadOptions = {},
): RequestHandler[] => [
    wrapMulter(buildMulterUpload({ ...options, maxFileCount: 1 }).single(fieldName)),
    validateUploadedImageContent,
];

export const uploadMultipleImages = (
    fieldName: string,
    maxFileCount: number = DEFAULT_MAX_FILE_COUNT,
    options: ImageUploadOptions = {},
): RequestHandler[] => [
    wrapMulter(
        buildMulterUpload({ ...options, maxFileCount }).array(fieldName, maxFileCount),
    ),
    validateUploadedImageContent,
];
