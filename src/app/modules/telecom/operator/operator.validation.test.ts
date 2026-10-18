import { describe, expect, it } from "vitest";
import {
    createOperatorZodSchema,
    updateOperatorZodSchema,
} from "./operator.validation";

const createIssuePaths = (result: ReturnType<typeof createOperatorZodSchema.safeParse>) =>
    result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));

const updateIssuePaths = (result: ReturnType<typeof updateOperatorZodSchema.safeParse>) =>
    result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));

describe("createOperatorZodSchema logo pairing", () => {
    it("accepts a payload without any logo", () => {
        const result = createOperatorZodSchema.safeParse({ name: "GP", code: "GP" });

        expect(result.success).toBe(true);
    });

    it("accepts a complete logo pair", () => {
        const result = createOperatorZodSchema.safeParse({
            name: "GP",
            code: "GP",
            logo: "https://res.cloudinary.com/demo/image/upload/operators/gp.png",
            logoPublicId: "rizqifybd/operators/gp",
        });

        expect(result.success).toBe(true);
    });

    it("rejects a logo without its public id", () => {
        const result = createOperatorZodSchema.safeParse({
            name: "GP",
            code: "GP",
            logo: "https://res.cloudinary.com/demo/image/upload/operators/gp.png",
        });

        expect(createIssuePaths(result)).toContain("logoPublicId");
    });

    it("rejects a public id without its logo", () => {
        const result = createOperatorZodSchema.safeParse({
            name: "GP",
            code: "GP",
            logoPublicId: "rizqifybd/operators/gp",
        });

        expect(createIssuePaths(result)).toContain("logo");
    });

    it("rejects a blank logo", () => {
        const result = createOperatorZodSchema.safeParse({
            name: "GP",
            code: "GP",
            logo: "   ",
            logoPublicId: "rizqifybd/operators/gp",
        });

        expect(createIssuePaths(result)).toContain("logo");
    });
});

describe("updateOperatorZodSchema logo pairing", () => {
    it("accepts a lone logo so legacy rows stay editable", () => {
        const result = updateOperatorZodSchema.safeParse({
            logo: "https://res.cloudinary.com/demo/image/upload/operators/legacy.png",
        });

        expect(result.success).toBe(true);
    });

    it("rejects a public id without its logo", () => {
        const result = updateOperatorZodSchema.safeParse({
            logoPublicId: "rizqifybd/operators/gp",
        });

        expect(updateIssuePaths(result)).toContain("logo");
    });

    it("accepts a complete replacement pair", () => {
        const result = updateOperatorZodSchema.safeParse({
            logo: "https://res.cloudinary.com/demo/image/upload/operators/gp.png",
            logoPublicId: "rizqifybd/operators/gp",
        });

        expect(result.success).toBe(true);
    });
});
