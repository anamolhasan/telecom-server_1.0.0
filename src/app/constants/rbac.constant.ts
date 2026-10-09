import { Role } from "../../generated/prisma/enums";

export const ALL_ROLES: Role[] = [
    Role.SUPER_ADMIN,
    Role.ADMIN,
    Role.MODERATOR,
    Role.SUPPORTER,
    Role.EMPLOYEE,
    Role.AGENT,
    Role.USER,
];

export const STAFF_ROLES: Role[] = [
    Role.SUPER_ADMIN,
    Role.ADMIN,
    Role.MODERATOR,
    Role.SUPPORTER,
    Role.EMPLOYEE,
];

export const CUSTOMER_ROLES: Role[] = [Role.USER, Role.AGENT];

export const ORDER_STAFF_ROLES: Role[] = STAFF_ROLES;

export const WITHDRAWAL_STAFF_ROLES: Role[] = [
    Role.SUPER_ADMIN,
    Role.ADMIN,
    Role.SUPPORTER,
    Role.EMPLOYEE,
];

export const CONTENT_ADMIN_ROLES: Role[] = [Role.SUPER_ADMIN, Role.ADMIN];

export const FINANCE_ROLES: Role[] = [Role.SUPER_ADMIN, Role.ADMIN];