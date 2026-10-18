import type { ProductStatus } from "../../../../generated/prisma/enums";

export interface IProductImagePayload {
    url: string;
    publicId?: string | null;
    altText?: string | null;
    position?: number;
}

export interface ICreateProductPayload {
    name: string;
    slug: string;
    description: string;
    categoryId: string;
    brandId?: string | null;
    status?: ProductStatus;
    isActive?: boolean;
    // When present, replaces the whole gallery (an empty array clears it).
    images?: IProductImagePayload[];
}

export type IUpdateProductPayload = Partial<ICreateProductPayload>;
