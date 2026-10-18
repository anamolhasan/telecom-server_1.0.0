import { afterEach, describe, expect, it, vi } from "vitest";
import status from "http-status";
import AppError from "../../errorHelpers/AppError";

const { uploadStreamMock, destroyMock } = vi.hoisted(() => ({
    uploadStreamMock: vi.fn(),
    destroyMock: vi.fn(),
}));

vi.mock("../../config/cloudinary.config", () => ({
    cloudinary: {
        uploader: {
            upload_stream: uploadStreamMock,
            destroy: destroyMock,
        },
    },
}));

import {
    DEFAULT_CLOUDINARY_FOLDER,
    deleteImageByPublicId,
    uploadImageBuffer,
} from "./cloudinary.service";

const SUCCESS_RESPONSE = {
    public_id: "rizqifybd/images/sample",
    secure_url: "https://res.cloudinary.com/demo/image/upload/sample.png",
    format: "png",
    resource_type: "image",
    width: 100,
    height: 50,
    bytes: 1234,
    created_at: "2026-01-01T00:00:00Z",
};

const mockUploadSuccess = () => {
    uploadStreamMock.mockImplementation(
        (_options: unknown, callback: (error: unknown, result: unknown) => void) => ({
            end: () => callback(null, SUCCESS_RESPONSE),
        }),
    );
};

afterEach(() => {
    vi.clearAllMocks();
});

describe("uploadImageBuffer", () => {
    it("streams the buffer to Cloudinary and returns only essential metadata", async () => {
        mockUploadSuccess();

        const result = await uploadImageBuffer(Buffer.from([1, 2, 3]));

        expect(uploadStreamMock).toHaveBeenCalledTimes(1);
        const [options] = uploadStreamMock.mock.calls[0];
        expect(options).toMatchObject({
            resource_type: "image",
            folder: DEFAULT_CLOUDINARY_FOLDER,
            allowed_formats: ["jpg", "png", "gif", "webp"],
            overwrite: false,
            unique_filename: true,
        });
        expect(result).toEqual({
            publicId: SUCCESS_RESPONSE.public_id,
            secureUrl: SUCCESS_RESPONSE.secure_url,
            format: "png",
            resourceType: "image",
            width: 100,
            height: 50,
            bytes: 1234,
            createdAt: SUCCESS_RESPONSE.created_at,
        });
    });

    it("applies a caller-provided folder and public id", async () => {
        mockUploadSuccess();

        await uploadImageBuffer(Buffer.from([1]), {
            folder: "rizqifybd/operators",
            publicId: "rizqifybd/operators/gp",
        });

        const [options] = uploadStreamMock.mock.calls[0];
        expect(options).toMatchObject({
            folder: "rizqifybd/operators",
            public_id: "rizqifybd/operators/gp",
        });
    });

    it("surfaces a generic AppError when the provider fails, without leaking details", async () => {
        uploadStreamMock.mockImplementation(
            (_options: unknown, callback: (error: unknown, result: unknown) => void) => ({
                end: () => callback({ message: "ACCESS DENIED secret", name: "Error", http_code: 401 }, undefined),
            }),
        );

        await expect(uploadImageBuffer(Buffer.from([1]))).rejects.toMatchObject({
            statusCode: status.BAD_GATEWAY,
        });

        await uploadImageBuffer(Buffer.from([1])).catch((error: AppError) => {
            expect(error.message).not.toContain("ACCESS DENIED");
            expect(error.message).not.toContain("secret");
        });
    });

    it("rejects an empty buffer without calling Cloudinary", async () => {
        await expect(uploadImageBuffer(Buffer.alloc(0))).rejects.toMatchObject({
            statusCode: status.BAD_REQUEST,
        });
        expect(uploadStreamMock).not.toHaveBeenCalled();
    });

    it("rejects unsafe folder values such as remote URLs", async () => {
        await expect(
            uploadImageBuffer(Buffer.from([1]), { folder: "https://evil.example.com" }),
        ).rejects.toBeInstanceOf(AppError);
        expect(uploadStreamMock).not.toHaveBeenCalled();
    });

    it("rejects path traversal in the public id", async () => {
        await expect(
            uploadImageBuffer(Buffer.from([1]), { publicId: "../../etc/passwd" }),
        ).rejects.toMatchObject({ statusCode: status.BAD_REQUEST });
        expect(uploadStreamMock).not.toHaveBeenCalled();
    });
});

describe("deleteImageByPublicId", () => {
    it("deletes by public id and returns the provider result", async () => {
        destroyMock.mockResolvedValue({ result: "ok" });

        const result = await deleteImageByPublicId("rizqifybd/images/sample");

        expect(destroyMock).toHaveBeenCalledWith("rizqifybd/images/sample", {
            resource_type: "image",
            invalidate: true,
        });
        expect(result).toEqual({ publicId: "rizqifybd/images/sample", result: "ok" });
    });

    it("treats a missing resource as a safe, non-throwing result", async () => {
        destroyMock.mockResolvedValue({ result: "not found" });

        await expect(deleteImageByPublicId("rizqifybd/images/gone")).resolves.toEqual({
            publicId: "rizqifybd/images/gone",
            result: "not found",
        });
    });

    it("rejects invalid public ids without calling the provider", async () => {
        await expect(deleteImageByPublicId("")).rejects.toMatchObject({
            statusCode: status.BAD_REQUEST,
        });
        await expect(
            deleteImageByPublicId("https://res.cloudinary.com/demo/image/upload/sample.png"),
        ).rejects.toMatchObject({ statusCode: status.BAD_REQUEST });

        expect(destroyMock).not.toHaveBeenCalled();
    });

    it("surfaces a generic AppError when the provider errors", async () => {
        destroyMock.mockRejectedValue(new Error("network timeout secret"));

        await expect(deleteImageByPublicId("rizqifybd/images/sample")).rejects.toMatchObject({
            statusCode: status.BAD_GATEWAY,
        });
    });
});
