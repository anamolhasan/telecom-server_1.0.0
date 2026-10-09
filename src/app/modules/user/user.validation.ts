import { z } from "zod";
import { Role, UserStatus } from "../../../generated/prisma/enums";

// AGENT is deliberately excluded: an AGENT is created by approving an Agent Application,
// not by direct staff creation. SUPER_ADMIN is included so the (SUPER_ADMIN-only) endpoint
// can mint accounts; the service layer enforces who may actually create each role.
const CREATABLE_ROLE_VALUES: Role[] = [
    Role.SUPER_ADMIN,
    Role.ADMIN,
    Role.MODERATOR,
    Role.SUPPORTER,
    Role.EMPLOYEE,
];

export const createStaffUserZodSchema = z.object({
    name: z.string({ error: "Name is required" }).trim().min(1, "Name is required"),
    email: z.string({ error: "Email is required" }).email("Invalid email address"),
    password: z.string({ error: "Password is required" }).min(6, "Password must be at least 6 characters"),
    role: z
        .nativeEnum(Role, { error: "Role is required" })
        .refine((role) => CREATABLE_ROLE_VALUES.includes(role), "This role cannot be created via the staff account endpoint"),
    profilePhoto: z.string().url("Profile photo must be a valid URL").optional(),
    contactNumber: z.string().trim().min(1, "Contact number cannot be empty").optional(),
});

export const updateUserProfileZodSchema = z.object({
    name: z.string().trim().min(1, "Name cannot be empty").optional(),
    phone: z.string().trim().min(1, "Phone cannot be empty").optional(),
    image: z.string().url("Image must be a valid URL").optional(),
    profilePhoto: z.string().url("Profile photo must be a valid URL").optional(),
    contactNumber: z.string().trim().min(1, "Contact number cannot be empty").optional(),
    address: z.string().trim().min(1, "Address cannot be empty").optional(),
    country: z.string().trim().min(1, "Country cannot be empty").optional(),
}).refine((data) => Object.keys(data).length > 0, "At least one field is required");

export const updateUserStatusZodSchema = z.object({
    status: z
        .nativeEnum(UserStatus)
        .refine((value) => value !== UserStatus.DELETED, `${UserStatus.DELETED} is handled by the delete endpoint`),
});

export const updateUserRoleZodSchema = z.object({
    role: z.nativeEnum(Role),
});

export const UserValidation = {
    createStaffUserZodSchema,
    updateUserProfileZodSchema,
    updateUserStatusZodSchema,
    updateUserRoleZodSchema,
};