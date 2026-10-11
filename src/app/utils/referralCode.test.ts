import { describe, expect, it, vi } from "vitest";
import {
    generateReferralCode,
    generateUniqueReferralCode,
} from "./referralCode";

describe("generateReferralCode", () => {
    it("returns an 8-character uppercase code without ambiguous characters", () => {
        const code = generateReferralCode();
        expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
        expect(code).not.toMatch(/[0O1I]/);
    });

    it("supports a custom length", () => {
        expect(generateReferralCode(6)).toHaveLength(6);
        expect(generateReferralCode(12)).toHaveLength(12);
    });

    it("generates distinct codes across calls", () => {
        const codes = new Set(Array.from({ length: 100 }, () => generateReferralCode()));
        expect(codes.size).toBeGreaterThan(1);
    });
});

describe("generateUniqueReferralCode", () => {
    const makeClient = (findUnique: ReturnType<typeof vi.fn>) => ({
        appUser: { findUnique },
    });

    it("returns the first candidate when it is not already taken", async () => {
        const findUnique = vi.fn().mockResolvedValue(null);
        const code = await generateUniqueReferralCode(makeClient(findUnique) as never);
        expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
        expect(findUnique).toHaveBeenCalledTimes(1);
    });

    it("retries with a fresh candidate when the first one is taken", async () => {
        const findUnique = vi
            .fn()
            .mockResolvedValueOnce({ id: "existing" })
            .mockResolvedValue(null);

        const code = await generateUniqueReferralCode(makeClient(findUnique) as never);

        expect(findUnique).toHaveBeenCalledTimes(2);
        expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    });

    it("throws when no unique candidate is found", async () => {
        const findUnique = vi.fn().mockResolvedValue({ id: "existing" });

        await expect(
            generateUniqueReferralCode(makeClient(findUnique) as never, 8, 5),
        ).rejects.toThrow("Could not generate a unique referral code");
        expect(findUnique).toHaveBeenCalledTimes(5);
    });
});