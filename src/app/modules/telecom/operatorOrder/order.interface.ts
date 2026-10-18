export interface ICreateOrderPayload {
    operatorOfferId: string;
    quantity?: number;
    targetNumber?: string;
    note?: string;
    // When supplied and different from the acting user, the acting user is the
    // seller (agent sale) and this is the buyer. Omitted means a personal purchase.
    buyerId?: string;
}

// A wallet-funded purchase: creates the order and pays for it from the acting
// user's wallet in a single database transaction. `idempotencyKey` lets a client
// safely retry without creating a duplicate order or charging the wallet twice.
export interface ICreateOrderWithWalletPayload extends ICreateOrderPayload {
    idempotencyKey?: string;
}
