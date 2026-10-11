export interface ILoginAppUserPayload {
    email: string;
    password: string;
}

export interface IRegisterAppUserPayload {
    name: string;
    email: string;
    password: string;
}

export interface IChangePasswordPayload {
    currentPassword: string;
    newPassword: string;
}
