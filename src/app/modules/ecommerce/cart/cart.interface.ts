export interface IAddCartItemPayload {
    variantId: string;
    // Defaults to 1 in the validation schema; the service always receives a
    // number by the time it runs.
    quantity: number;
}

export interface IUpdateCartItemPayload {
    quantity: number;
}
