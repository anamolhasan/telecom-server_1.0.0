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