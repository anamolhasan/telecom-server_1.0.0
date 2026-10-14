import { describe, expect, it } from "vitest";
import { Role } from "../../../generated/prisma/enums";
import { ALL_ROLES, PERMISSIONS } from "../../constants/rbac.constant";
import { RoleAccessService } from "./roleAccess.service";

const VALID_STATES = ["ALLOWED", "LIMITED", "DENIED"];

describe("RoleAccessService.getRoleAccessMatrix", () => {
    it("returns every role and every permission", () => {
        const matrix = RoleAccessService.getRoleAccessMatrix();

        expect(matrix.roles).toEqual([...ALL_ROLES]);
        expect(matrix.permissions).toEqual([...PERMISSIONS]);
        expect(Object.keys(matrix.matrix).sort()).toEqual([...ALL_ROLES].sort());
    });

    it("materializes a state for every role/permission pair", () => {
        const { matrix } = RoleAccessService.getRoleAccessMatrix();

        for (const role of ALL_ROLES) {
            for (const permission of PERMISSIONS) {
                expect(VALID_STATES).toContain(matrix[role][permission]);
            }
        }
    });

    it("marks SUPER_ADMIN as allowed for everything", () => {
        const { matrix } = RoleAccessService.getRoleAccessMatrix();

        for (const permission of PERMISSIONS) {
            expect(matrix[Role.SUPER_ADMIN][permission]).toBe("ALLOWED");
        }
    });

    it("denies ADMIN the global role-permission configuration", () => {
        const { matrix } = RoleAccessService.getRoleAccessMatrix();

        expect(matrix[Role.ADMIN]["role_permissions.manage"]).toBe("DENIED");
    });

    it("defaults ungranted pairs to DENIED", () => {
        const { matrix } = RoleAccessService.getRoleAccessMatrix();

        expect(matrix[Role.USER]["role_permissions.manage"]).toBe("DENIED");
        expect(matrix[Role.EMPLOYEE]["audit_logs.read"]).toBe("DENIED");
    });
});
