export interface ICreateCategoryPayload {
    name: string;
    slug: string;
    description?: string | null;
    image?: string;
    imagePublicId?: string;
    // `null` detaches the category from its parent (top level).
    parentId?: string | null;
    isActive?: boolean;
}

export type IUpdateCategoryPayload = Partial<ICreateCategoryPayload>;
