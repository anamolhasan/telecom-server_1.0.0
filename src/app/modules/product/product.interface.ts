import { ProductType } from "../../../generated/prisma/enums";

export interface ICreateProductPayload {
    operatorId: string;
    name: string;
    description?: string;
    type?: ProductType;
    price: number;
    commissionRate?: number;
    isActive?: boolean;
}

export type IUpdateProductPayload = Partial<ICreateProductPayload>;
