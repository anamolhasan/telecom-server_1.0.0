import type { Role } from "../../../../generated/prisma/enums";
import { CONTENT_ADMIN_ROLES } from "../../../constants/rbac.constant";

// Only content admins (super admin / admin) may receive an offer's internal
// commercial configuration. Every other caller — anonymous or a non-admin
// session — receives the public projection only. Kept in one place so the
// public read endpoints stay consistent with the guarded write endpoints.
export function canViewCommercialOfferData(
    role: Role | null | undefined,
): boolean {
    return role != null && CONTENT_ADMIN_ROLES.includes(role);
}
