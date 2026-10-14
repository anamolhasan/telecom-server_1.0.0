import { describe, expect, it } from "vitest";
import { Role } from "../../generated/prisma/enums";
import {
    ALL_ROLES,
    can,
    getPermissionState,
    PERMISSIONS,
    ROLE_ACCESS_MANAGERS,
    type Permission,
} from "./rbac.constant";

describe("role access managers", () => {
    it("only SUPER_ADMIN may manage global role permissions", () => {
        expect(ROLE_ACCESS_MANAGERS).toEqual([Role.SUPER_ADMIN]);
    });
});

describe("ROLE_PERMISSIONS policy", () => {
    it("grants SUPER_ADMIN every permission", () => {
        for (const permission of PERMISSIONS) {
            expect(can(Role.SUPER_ADMIN, permission)).toBe(true);
            expect(getPermissionState(Role.SUPER_ADMIN, permission)).toBe("ALLOWED");
        }
    });

    it("never lets ADMIN manage the global role permission configuration", () => {
        expect(getPermissionState(Role.ADMIN, "role_permissions.manage")).toBe(
            "DENIED",
        );
        expect(can(Role.ADMIN, "role_permissions.manage")).toBe(false);
    });

    it("denies role_permissions.manage for every non SUPER_ADMIN role", () => {
        for (const role of ALL_ROLES) {
            if (role === Role.SUPER_ADMIN) continue;
            expect(can(role, "role_permissions.manage")).toBe(false);
        }
    });

    it("keeps ADMIN's operational capabilities but limits role management", () => {
        expect(can(Role.ADMIN, "users.read")).toBe(true);
        expect(can(Role.ADMIN, "offers.manage")).toBe(true);
        expect(can(Role.ADMIN, "wallet.adjust")).toBe(true);
        // Limited, never a blanket grant.
        expect(getPermissionState(Role.ADMIN, "roles.manage")).toBe("LIMITED");
        expect(can(Role.ADMIN, "roles.manage")).toBe(false);
    });

    it("does not treat LIMITED as a grant", () => {
        expect(can(Role.USER, "orders.manage")).toBe(false);
        expect(getPermissionState(Role.USER, "orders.manage")).toBe("LIMITED");
        expect(can(Role.MODERATOR, "orders.manage")).toBe(true);
    });
});

describe("getPermissionState default-deny", () => {
    it("denies a permission that is not explicitly granted", () => {
        expect(getPermissionState(Role.ADMIN, "audit_logs.read")).toBe("DENIED");
        expect(getPermissionState(Role.USER, "users.read")).toBe("DENIED");
    });

    it("denies unknown permissions instead of throwing", () => {
        expect(getPermissionState(Role.SUPER_ADMIN, "does.not.exist" as Permission)).toBe(
            "DENIED",
        );
        expect(can(Role.SUPER_ADMIN, "does.not.exist" as Permission)).toBe(false);
    });
});

describe("agent is not a role", () => {
    it("has no AGENT entry in the Role enum", () => {
        expect((Role as Record<string, string>).AGENT).toBeUndefined();
    });

    it("an approved agent (USER with canEarn) has no global role permissions", () => {
        // canEarn is a feature flag on the account, not a role; the matrix is
        // keyed by Role.USER, so an agent can never manage role permissions.
        expect(can(Role.USER, "role_permissions.manage")).toBe(false);
        expect(can(Role.USER, "roles.manage")).toBe(false);
    });
});
