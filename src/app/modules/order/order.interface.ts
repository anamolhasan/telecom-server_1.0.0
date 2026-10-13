export interface ICreateOrderPayload {
    productId: string;
    quantity?: number;
    targetNumber?: string;
    note?: string;
    // When supplied and different from the acting user, the acting user is the
    // seller (agent sale) and this is the buyer. Omitted means a personal purchase.
    buyerId?: string;
}
