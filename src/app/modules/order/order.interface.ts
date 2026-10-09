export interface ICreateOrderPayload {
    productId: string;
    quantity?: number;
    targetNumber?: string;
    note?: string;
}
