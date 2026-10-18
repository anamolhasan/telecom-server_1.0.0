import type { Role } from "../../../generated/prisma/enums";
import { ProductStatus } from "../../../generated/prisma/enums";
import { CONTENT_ADMIN_ROLES } from "../../constants/rbac.constant";

// Catalog content management is restricted to the existing content-admin roles
// (SUPER_ADMIN / ADMIN) — the same constant that already guards Operator and
// OperatorOffer writes. It also matches the Role Access policy exactly:
// `can(role, "offers.manage")` is ALLOWED for SUPER_ADMIN/ADMIN and DENIED for
// every other role, so no new role or permission is invented here.
export const canManageCatalog = (role: Role | null | undefined): boolean =>
    role != null && CONTENT_ADMIN_ROLES.includes(role);

// A content admin is also the only caller allowed to read unpublished catalog
// rows (drafts, paused/inactive and archived records). Everyone else — anonymous
// or a signed-in customer — receives the published subset only.
export const canViewUnpublishedCatalog = canManageCatalog;

// Visibility predicates. The services spread these into a Prisma `where` clause
// *after* the QueryBuilder applied user-supplied filters, so a query string can
// never widen the public projection.
export const publishedCategoryWhere = {
    isDeleted: false,
    isActive: true,
} as const;

export const publishedBrandWhere = {
    isDeleted: false,
    isActive: true,
} as const;

export const publishedProductWhere = {
    isDeleted: false,
    isActive: true,
    status: ProductStatus.ACTIVE,
} as const;

// Variants carry their own flags and additionally require a published parent
// product, so drafting/archiving a product hides all of its SKUs at once.
export const publishedVariantWhere = {
    isDeleted: false,
    isActive: true,
} as const;

export const publishedVariantWithProductWhere = {
    isDeleted: false,
    isActive: true,
    product: publishedProductWhere,
} as const;
