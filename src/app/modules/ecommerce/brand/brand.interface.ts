export interface ICreateBrandPayload {
    name: string;
    slug: string;
    description?: string | null;
    logo?: string;
    logoPublicId?: string;
    isActive?: boolean;
}

export type IUpdateBrandPayload = Partial<ICreateBrandPayload>;
