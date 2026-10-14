import { Role } from "../../../generated/prisma/enums";
import {
    ALL_ROLES,
    getPermissionState,
    PERMISSIONS,
    type Permission,
    type PermissionState,
} from "../../constants/rbac.constant";

export interface IRoleAccessMatrix {
    roles: Role[];
    permissions: Permission[];
    matrix: Record<Role, Record<Permission, PermissionState>>;
}

// Builds the full role x permission matrix from the centralized RBAC policy.
// Every role/permission pair is materialized (defaulting to DENIED) so clients
// never have to infer the default. No database access is involved in this step.
const buildMatrix = (): Record<Role, Record<Permission, PermissionState>> =>
    ALL_ROLES.reduce(
        (matrix, role) => {
            matrix[role] = PERMISSIONS.reduce(
                (row, permission) => {
                    row[permission] = getPermissionState(role, permission);
                    return row;
                },
                {} as Record<Permission, PermissionState>,
            );
            return matrix;
        },
        {} as Record<Role, Record<Permission, PermissionState>>,
    );

const getRoleAccessMatrix = (): IRoleAccessMatrix => ({
    roles: [...ALL_ROLES],
    permissions: [...PERMISSIONS],
    matrix: buildMatrix(),
});

export const RoleAccessService = {
    getRoleAccessMatrix,
};
