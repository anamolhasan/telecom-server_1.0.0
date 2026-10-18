import { Role } from "../../generated/prisma/enums";

export const ALL_ROLES: Role[] = [
    Role.SUPER_ADMIN,
    Role.ADMIN,
    Role.MODERATOR,
    Role.SUPPORTER,
    Role.EMPLOYEE,
    Role.USER,
];

export const STAFF_ROLES: Role[] = [
    Role.SUPER_ADMIN,
    Role.ADMIN,
    Role.MODERATOR,
    Role.SUPPORTER,
    Role.EMPLOYEE,
];

// Agent is not a role: an approved agent is a USER granted the reseller feature
// set via AppUser.canEarn. All customers therefore hold Role.USER.
export const CUSTOMER_ROLES: Role[] = [Role.USER];

export const ORDER_STAFF_ROLES: Role[] = STAFF_ROLES;

export const WITHDRAWAL_STAFF_ROLES: Role[] = [
    Role.SUPER_ADMIN,
    Role.ADMIN,
    Role.SUPPORTER,
    Role.EMPLOYEE,
];

export const CONTENT_ADMIN_ROLES: Role[] = [Role.SUPER_ADMIN, Role.ADMIN];

export const FINANCE_ROLES: Role[] = [Role.SUPER_ADMIN, Role.ADMIN];

export const ROLE_MANAGEMENT_ACTORS: Role[] = [Role.SUPER_ADMIN, Role.ADMIN];

export const AGENT_APPLICATION_ACTORS: Role[] = [Role.SUPER_ADMIN, Role.ADMIN];

export const AFFILIATE_APPLICATION_ACTORS: Role[] = [Role.SUPER_ADMIN, Role.ADMIN];

// Who may CREATE accounts with each role. Agent is not a creatable role: an
// approved agent keeps Role.USER and is granted access by approving an Agent
// Application, not by staff account creation or a role change.
// Rule 2: only SUPER_ADMIN can create another SUPER_ADMIN.
// Rule 5: SUPER_ADMIN creates SUPER_ADMIN/ADMIN/MODERATOR/SUPPORTER/EMPLOYEE.
// Rule 6: ADMIN creates ADMIN/MODERATOR/SUPPORTER/EMPLOYEE (never a SUPER_ADMIN).
export const CREATABLE_ROLES_BY_ROLE: Record<Role, Role[]> = {
    [Role.SUPER_ADMIN]: [
        Role.SUPER_ADMIN,
        Role.ADMIN,
        Role.MODERATOR,
        Role.SUPPORTER,
        Role.EMPLOYEE,
    ],
    [Role.ADMIN]: [Role.ADMIN, Role.MODERATOR, Role.SUPPORTER, Role.EMPLOYEE],
    [Role.MODERATOR]: [],
    [Role.SUPPORTER]: [],
    [Role.EMPLOYEE]: [],
    [Role.USER]: [],
};

// Who may MANAGE (view details, update profile, update status, delete) a target role.
// Rule 1: SUPER_ADMIN and ADMIN manage all other roles except the restrictions below.
// Rule 4: ADMIN can never manage a SUPER_ADMIN.
// Note: ADMIN cannot manage another ADMIN (administrators are peers of each other);
//       ADMIN does manage MODERATOR/SUPPORTER/EMPLOYEE plus customers (USER).
export const MANAGEABLE_ROLES_BY_ROLE: Record<Role, Role[]> = {
    [Role.SUPER_ADMIN]: ALL_ROLES,
    [Role.ADMIN]: [
        Role.MODERATOR,
        Role.SUPPORTER,
        Role.EMPLOYEE,
        Role.USER,
    ],
    [Role.MODERATOR]: [],
    [Role.SUPPORTER]: [],
    [Role.EMPLOYEE]: [],
    [Role.USER]: [],
};

export const canCreateRole = (actorRole: Role, targetRole: Role): boolean =>
    CREATABLE_ROLES_BY_ROLE[actorRole].includes(targetRole);

export const canManageTarget = (actorRole: Role, targetRole: Role): boolean =>
    MANAGEABLE_ROLES_BY_ROLE[actorRole].includes(targetRole);

export const canChangeRole = (
    actorRole: Role,
    targetRole: Role,
    newRole: Role,
): boolean => {
    // Rule 4: only SUPER_ADMIN may grant or revoke the SUPER_ADMIN role.
    if (targetRole === Role.SUPER_ADMIN || newRole === Role.SUPER_ADMIN) {
        return actorRole === Role.SUPER_ADMIN;
    }
    // Rule 6: ADMIN may never change any role to/from ADMIN (no privilege escalation
    // via role change), and may only touch roles within its management scope.
    return canManageTarget(actorRole, targetRole) && canManageTarget(actorRole, newRole);
};

// Role Access Management (the global permission policy) is owned exclusively by
// the system owner. ADMIN keeps its operational capabilities (see the create /
// manage / change-role rules above) but can never read or change global role
// permissions. AGENT is intentionally absent: it is a feature audience granted
// via AppUser.canEarn, never a Role.
export const ROLE_ACCESS_MANAGERS: Role[] = [Role.SUPER_ADMIN];

// Canonical permission identifiers used by the Role Access policy. These are the
// single source of truth the server serves and, in a later step, enforces. They
// intentionally reuse the identifiers exposed by the frontend Role Access page.
export const PERMISSIONS = [
    "users.read",
    "users.update",
    "users.block",
    "users.delete",
    "roles.manage",
    "role_permissions.manage",
    "offers.manage",
    "orders.manage",
    "wallet.read",
    "wallet.adjust",
    "withdrawals.review",
    "commissions.manage",
    "audit_logs.read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

// ALLOWED / LIMITED / DENIED mirrors the frontend matrix. LIMITED means the actor
// may perform the operation only within a narrower, scope-checked boundary (the
// existing service-layer rules), and is therefore never treated as a blanket grant.
export type PermissionState = "ALLOWED" | "LIMITED" | "DENIED";

// The proposed/target role-permission policy. Only granted states are listed;
// any pair that is absent is denied (see getPermissionState). Kept deliberately
// aligned with the existing create/manage/change-role rules above.
export const ROLE_PERMISSIONS: Record<
    Role,
    Partial<Record<Permission, PermissionState>>
> = {
    [Role.SUPER_ADMIN]: {
        "users.read": "ALLOWED",
        "users.update": "ALLOWED",
        "users.block": "ALLOWED",
        "users.delete": "ALLOWED",
        "roles.manage": "ALLOWED",
        "role_permissions.manage": "ALLOWED",
        "offers.manage": "ALLOWED",
        "orders.manage": "ALLOWED",
        "wallet.read": "ALLOWED",
        "wallet.adjust": "ALLOWED",
        "withdrawals.review": "ALLOWED",
        "commissions.manage": "ALLOWED",
        "audit_logs.read": "ALLOWED",
    },
    [Role.ADMIN]: {
        "users.read": "ALLOWED",
        "users.update": "ALLOWED",
        "users.block": "ALLOWED",
        "users.delete": "LIMITED",
        "roles.manage": "LIMITED",
        "offers.manage": "ALLOWED",
        "orders.manage": "ALLOWED",
        "wallet.read": "ALLOWED",
        "wallet.adjust": "ALLOWED",
        "withdrawals.review": "ALLOWED",
        "commissions.manage": "LIMITED",
    },
    [Role.MODERATOR]: {
        "users.read": "ALLOWED",
        "users.block": "ALLOWED",
        "orders.manage": "ALLOWED",
    },
    [Role.SUPPORTER]: {
        "users.read": "ALLOWED",
        "users.block": "LIMITED",
        "orders.manage": "LIMITED",
        "wallet.read": "LIMITED",
        "withdrawals.review": "LIMITED",
    },
    [Role.EMPLOYEE]: {
        "users.read": "LIMITED",
        "orders.manage": "LIMITED",
        "wallet.read": "LIMITED",
        "withdrawals.review": "LIMITED",
    },
    [Role.USER]: {
        "orders.manage": "LIMITED",
        "wallet.read": "LIMITED",
    },
};

// Default-deny: any role/permission pair that is not explicitly granted is denied.
export const getPermissionState = (
    role: Role,
    permission: Permission,
): PermissionState => ROLE_PERMISSIONS[role]?.[permission] ?? "DENIED";

// Authorization helper: only an explicit ALLOWED state counts as a grant. LIMITED
// operations must still pass their own scope checks in the service layer.
export const can = (role: Role, permission: Permission): boolean =>
    getPermissionState(role, permission) === "ALLOWED";