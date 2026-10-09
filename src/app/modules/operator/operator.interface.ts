export interface ICreateOperatorPayload {
    name: string;
    code: string;
    logo?: string;
    isActive?: boolean;
}

export type IUpdateOperatorPayload = Partial<ICreateOperatorPayload>;
