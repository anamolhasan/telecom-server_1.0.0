export interface ICreateOperatorPayload {
    name: string;
    code: string;
    logo?: string;
    logoPublicId?: string;
    isActive?: boolean;
}

export type IUpdateOperatorPayload = Partial<ICreateOperatorPayload>;
