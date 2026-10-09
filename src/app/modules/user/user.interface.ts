import { Role, UserStatus } from "../../../generated/prisma/enums";

export interface ICreateStaffPayload {
  name: string;
  email: string;
  password: string;
  role: Role;
  profilePhoto?: string;
  contactNumber?: string;
}

export interface IUpdateUserProfilePayload {
  name?: string;
  phone?: string;
  image?: string;
  profilePhoto?: string;
  contactNumber?: string;
  address?: string;
  country?: string;
}

export interface IUpdateUserStatusPayload {
  status: UserStatus;
}

export interface IUpdateUserRolePayload {
  role: Role;
}