import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import cookieParser from "cookie-parser";
import status from "http-status";
import { Role, UserStatus } from "../../../generated/prisma/enums";
import { envVars } from "../../config/env";
import { globalErrorHandler } from "../../middleware/globalErrorHandler";
import { jwtUtils } from "../../utils/jwt";
import { UploadRoutes } from "./upload.route";

// Route -> checkAuth -> multer -> content validation -> controller -> service
// pipeline runs for real; only the Prisma session lookup and the Cloudinary SDK
// are mocked, so no real credentials are required.
const mocks = vi.hoisted(() => ({
    sessionFindFirst: vi.fn(),
    uploadStream: vi.fn(),
}));

vi.mock("../../lib/prisma", () => ({
    prisma: {
        session: { findFirst: mocks.sessionFindFirst },
    },
}));

vi.mock("../../config/cloudinary.config", () => ({
    cloudinary: {
        uploader: {
            upload_stream: mocks.uploadStream,
        },
    },
}));

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

const SUCCESS_RESPONSE = {
    public_id: "rizqifybd/images/sample",
    secure_url: "https://res.cloudinary.com/demo/image/upload/sample.png",
    format: "png",
    resource_type: "image",
    width: 100,
    height: 50,
    bytes: 4096,
    created_at: "2026-01-01T00:00:00Z",
};

const buildSession = (role: Role) => ({
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    createdAt: new Date(Date.now() - 60 * 60 * 1000),
    user: {
        id: "u-1",
        role,
        email: "u@x.com",
        status: UserStatus.ACTIVE,
        isDeleted: false,
    },
});

const buildCookie = (role: Role) => {
    const accessToken = jwtUtils.createToken(
        { userId: "u-1", role, email: "u@x.com" },
        envVars.ACCESS_TOKEN_SECRET,
        { expiresIn: "1h" },
    );

    return [
        "better-auth.session_token=session-token",
        `accessToken=${accessToken}`,
    ].join("; ");
};

const app = express();
app.use(cookieParser());
app.use("/uploads", UploadRoutes);
app.use(globalErrorHandler);

let server: Server;
let baseUrl: string;

interface ApiBody {
    success: boolean;
    message: string;
    data?: Record<string, unknown>;
    errorSources?: Array<{ path: string; message: string }>;
}

const imageForm = (data: Buffer, filename = "test.png", type = "image/png") => {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(data)], { type }), filename);
    return form;
};

const postImage = async (
    form: FormData,
    role?: Role,
): Promise<{ status: number; body: ApiBody }> => {
    const headers: Record<string, string> = {};

    if (role) {
        mocks.sessionFindFirst.mockResolvedValue(buildSession(role));
        headers.Cookie = buildCookie(role);
    }

    const response = await fetch(`${baseUrl}/uploads/image`, {
        method: "POST",
        headers,
        body: form,
    });

    return { status: response.status, body: (await response.json()) as ApiBody };
};

beforeAll(async () => {
    await new Promise<void>((resolve) => {
        server = app.listen(0, () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    });
});

afterEach(() => {
    vi.clearAllMocks();
});

describe("POST /uploads/image authorization", () => {
    it("rejects unauthenticated requests with 401 and never touches Cloudinary", async () => {
        const { status: httpStatus, body } = await postImage(imageForm(PNG_HEADER));

        expect(httpStatus).toBe(status.UNAUTHORIZED);
        expect(body.success).toBe(false);
        expect(mocks.sessionFindFirst).not.toHaveBeenCalled();
        expect(mocks.uploadStream).not.toHaveBeenCalled();
    });

    it.each([Role.USER, Role.MODERATOR, Role.SUPPORTER, Role.EMPLOYEE])(
        "forbids the under-privileged role %s with 403",
        async (role) => {
            const { status: httpStatus, body } = await postImage(imageForm(PNG_HEADER), role);

            expect(httpStatus).toBe(status.FORBIDDEN);
            expect(body.success).toBe(false);
            expect(mocks.uploadStream).not.toHaveBeenCalled();
        },
    );
});

describe("POST /uploads/image", () => {
    it("uploads an authenticated admin image and returns essential metadata only", async () => {
        mocks.uploadStream.mockImplementation(
            (_options: unknown, callback: (error: unknown, result: unknown) => void) => ({
                end: () => callback(null, SUCCESS_RESPONSE),
            }),
        );

        const { status: httpStatus, body } = await postImage(imageForm(PNG_HEADER), Role.ADMIN);

        expect(httpStatus).toBe(status.CREATED);
        expect(body.success).toBe(true);
        expect(mocks.sessionFindFirst).toHaveBeenCalledTimes(1);
        expect(mocks.uploadStream).toHaveBeenCalledTimes(1);
        expect(body.data).toEqual({
            secureUrl: SUCCESS_RESPONSE.secure_url,
            publicId: SUCCESS_RESPONSE.public_id,
            format: "png",
            width: 100,
            height: 50,
        });
    });

    it("allows SUPER_ADMIN as well", async () => {
        mocks.uploadStream.mockImplementation(
            (_options: unknown, callback: (error: unknown, result: unknown) => void) => ({
                end: () => callback(null, SUCCESS_RESPONSE),
            }),
        );

        const { status: httpStatus } = await postImage(imageForm(PNG_HEADER), Role.SUPER_ADMIN);

        expect(httpStatus).toBe(status.CREATED);
    });

    it("rejects an authenticated request with no file", async () => {
        const { status: httpStatus, body } = await postImage(new FormData(), Role.ADMIN);

        expect(httpStatus).toBe(status.BAD_REQUEST);
        expect(body.success).toBe(false);
        expect(mocks.uploadStream).not.toHaveBeenCalled();
    });

    it("rejects declared images whose content is not a real image", async () => {
        const fakeImage = Buffer.from("this is definitely not an image");

        const { status: httpStatus, body } = await postImage(
            imageForm(fakeImage, "test.png", "image/png"),
            Role.ADMIN,
        );

        expect(httpStatus).toBe(status.UNSUPPORTED_MEDIA_TYPE);
        expect(body.success).toBe(false);
        expect(mocks.uploadStream).not.toHaveBeenCalled();
    });

    it("rejects files that exceed the configured size limit with 413", async () => {
        const oversized = Buffer.alloc(MAX_FILE_SIZE_BYTES + 1024);
        PNG_HEADER.copy(oversized);

        const { status: httpStatus, body } = await postImage(imageForm(oversized), Role.ADMIN);

        expect(httpStatus).toBe(status.REQUEST_ENTITY_TOO_LARGE);
        expect(body.success).toBe(false);
        expect(mocks.uploadStream).not.toHaveBeenCalled();
    });

    it("surfaces a generic 502 when the Cloudinary provider fails", async () => {
        mocks.uploadStream.mockImplementation(
            (_options: unknown, callback: (error: unknown, result: unknown) => void) => ({
                end: () =>
                    callback(
                        { message: "ACCESS DENIED secret detail", name: "Error", http_code: 401 },
                        undefined,
                    ),
            }),
        );

        const { status: httpStatus, body } = await postImage(imageForm(PNG_HEADER), Role.ADMIN);

        expect(httpStatus).toBe(status.BAD_GATEWAY);
        expect(body.success).toBe(false);
        expect(body.message).toBe("Image upload failed. Please try again later.");
        expect(body.message).not.toContain("ACCESS DENIED");
        expect(body.errorSources?.[0]?.message).toBe(body.message);
    });
});
