import { describe, expect, it, vi } from "vitest";
import status from "http-status";
import multer from "multer";
import AppError from "../errorHelpers/AppError";
import {
    normalizeMulterError,
    sniffImageMimeType,
    validateUploadedImageContent,
} from "./upload.middleware";

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const GIF_HEADER = Buffer.from("GIF89a", "ascii");
const WEBP_HEADER = Buffer.concat([
    Buffer.from("RIFF", "ascii"),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    Buffer.from("WEBP", "ascii"),
]);
const TEXT_BODY = Buffer.from("this is definitely not an image", "utf8");

describe("sniffImageMimeType", () => {
    it("detects supported image formats from their magic bytes", () => {
        expect(sniffImageMimeType(PNG_HEADER)).toBe("image/png");
        expect(sniffImageMimeType(JPEG_HEADER)).toBe("image/jpeg");
        expect(sniffImageMimeType(Buffer.from("GIF87a"))).toBe("image/gif");
        expect(sniffImageMimeType(Buffer.concat([GIF_HEADER, Buffer.from("...")]))).toBe("image/gif");
        expect(sniffImageMimeType(WEBP_HEADER)).toBe("image/webp");
    });

    it("returns null for non-image content", () => {
        expect(sniffImageMimeType(Buffer.from("not an image at all"))).toBeNull();
        expect(sniffImageMimeType(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"))).toBeNull();
    });

    it("returns null for empty or undersized buffers", () => {
        expect(sniffImageMimeType(Buffer.alloc(0))).toBeNull();
        expect(sniffImageMimeType(Buffer.from([0xff, 0xd8]))).toBeNull();
    });
});

describe("normalizeMulterError", () => {
    it("maps LIMIT_FILE_SIZE to a 413 AppError", () => {
        const result = normalizeMulterError(new multer.MulterError("LIMIT_FILE_SIZE"));
        expect(result).toBeInstanceOf(AppError);
        expect((result as AppError).statusCode).toBe(status.REQUEST_ENTITY_TOO_LARGE);
    });

    it("maps unexpected file fields to a 400 AppError", () => {
        const result = normalizeMulterError(new multer.MulterError("LIMIT_UNEXPECTED_FILE"));
        expect(result).toBeInstanceOf(AppError);
        expect((result as AppError).statusCode).toBe(status.BAD_REQUEST);
    });

    it("passes through an existing AppError unchanged", () => {
        const original = new AppError(status.UNSUPPORTED_MEDIA_TYPE, "nope");
        expect(normalizeMulterError(original)).toBe(original);
    });

    it("wraps unknown errors without leaking their message", () => {
        const result = normalizeMulterError(new Error("secret internal detail"));
        expect(result).toBeInstanceOf(AppError);
        expect((result as AppError).statusCode).toBe(status.BAD_REQUEST);
        expect(result.message).not.toContain("secret internal detail");
    });
});

describe("validateUploadedImageContent", () => {
    const makeReq = (file?: Partial<Express.Multer.File>) =>
        ({ file: file ? (file as Express.Multer.File) : undefined }) as never;

    it("accepts a file whose header matches its declared MIME type", () => {
        const next = vi.fn();
        const req = makeReq({ buffer: PNG_HEADER, mimetype: "image/png" });

        validateUploadedImageContent(req, {} as never, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith();
    });

    it("rejects a file whose content is not a supported image", () => {
        const next = vi.fn();
        const req = makeReq({ buffer: TEXT_BODY, mimetype: "image/png" });

        validateUploadedImageContent(req, {} as never, next);

        expect(next).toHaveBeenCalledWith(
            expect.objectContaining({ statusCode: status.UNSUPPORTED_MEDIA_TYPE }),
        );
    });

    it("rejects a file whose content does not match the declared MIME type", () => {
        const next = vi.fn();
        const req = makeReq({ buffer: JPEG_HEADER, mimetype: "image/png" });

        validateUploadedImageContent(req, {} as never, next);

        expect(next).toHaveBeenCalledWith(
            expect.objectContaining({ statusCode: status.UNSUPPORTED_MEDIA_TYPE }),
        );
    });

    it("rejects an empty file buffer", () => {
        const next = vi.fn();
        const req = makeReq({ buffer: Buffer.alloc(0), mimetype: "image/png" });

        validateUploadedImageContent(req, {} as never, next);

        expect(next).toHaveBeenCalledWith(
            expect.objectContaining({ statusCode: status.BAD_REQUEST }),
        );
    });

    it("continues when no files were uploaded", () => {
        const next = vi.fn();
        validateUploadedImageContent(makeReq(), {} as never, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith();
    });
});
