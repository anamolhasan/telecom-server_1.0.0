export interface IInitialInventoryPayload {
    availableQuantity: number;
    lowStockThreshold?: number | null;
}

export interface ICreateProductVariantPayload {
    productId: string;
    sku: string;
    name?: string | null;
    attributes?: Record<string, unknown> | null;
    price: number;
    compareAtPrice?: number | null;
    isActive?: boolean;
    // Optional opening stock. Later stock changes go through the inventory
    // endpoints so there is a single write path (and a single audit trail).
    inventory?: IInitialInventoryPayload;
}

// A variant cannot be moved between products and its stock is not settable here,
// so both are excluded from the update contract.
export type IUpdateProductVariantPayload = Partial<
    Omit<ICreateProductVariantPayload, "productId" | "inventory">
>;
