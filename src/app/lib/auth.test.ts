import { describe, expect, it } from "vitest";
import { auth } from "./auth";

interface AdditionalFieldConfig {
    input?: boolean;
    defaultValue?: unknown;
}

const additionalFields = () =>
    (auth.options.user?.additionalFields ?? {}) as Record<string, AdditionalFieldConfig>;

// Regression guard: privileged user fields must never be settable from a client
// payload (POST /api/auth/sign-up/email or /api/auth/update-user). Without
// `input: false` a caller can self-assign role/status and bypass the staff
// creation RBAC entirely.
const PRIVILEGED_FIELDS = [
    "role",
    "status",
    "needPasswordChange",
    "isDeleted",
    "deletedAt",
    "phoneVerified",
] as const;

describe("better-auth additionalFields hardening", () => {
    it.each(PRIVILEGED_FIELDS)(
        "marks the privileged '%s' field as input: false",
        (field) => {
            const config = additionalFields()[field];
            expect(config, `additionalFields.${field} should be configured`).toBeDefined();
            expect(config?.input).toBe(false);
        },
    );

    it("defaults role to USER so public sign-up can only create customers", () => {
        expect(additionalFields().role?.defaultValue).toBe("USER");
    });
});
