import { describe, expect, it, vi } from "vitest";
import status from "http-status";
import { Role } from "../../generated/prisma/enums";
import { checkAuth } from "./checkAuth";

describe("checkAuth", () => {
    it("rejects unauthenticated requests that carry no session token", async () => {
        const middleware = checkAuth(Role.SUPER_ADMIN);
        const req = { cookies: {} } as never;
        const res = { setHeader: vi.fn() } as never;
        const next = vi.fn();

        await middleware(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith(
            expect.objectContaining({ statusCode: status.UNAUTHORIZED }),
        );
    });
});