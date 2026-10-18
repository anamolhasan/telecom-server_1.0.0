export interface ISetInventoryPayload {
    availableQuantity: number;
    lowStockThreshold?: number | null;
}

export interface IAdjustInventoryPayload {
    // Signed whole-number change: positive restocks, negative draws stock down.
    delta: number;
}
