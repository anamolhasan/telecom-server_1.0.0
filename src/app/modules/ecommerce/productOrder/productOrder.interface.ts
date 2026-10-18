import type {
    ProductOrderStatus,
    ProductPaymentMethod,
    ProductPaymentStatus,
} from "../../../../generated/prisma/enums";

// Delivery snapshot accepted inline at checkout. Mirrors the ShippingAddress
// model (shippingAddress.prisma) so a saved address and an inline address
// produce the same immutable snapshot on ProductOrder.
export interface IShippingAddressSnapshot {
    recipientName: string;
    phone: string;
    division: string;
    district: string;
    upazila?: string;
    unionArea?: string;
    villageRoad?: string;
    postalCode?: string;
}

// Everything a client may send to place an order. Prices, stock, totals,
// payment/fulfilment state and the buyer identity are all derived server-side
// and therefore have no place in this payload.
export interface ICheckoutPayload {
    // Client-generated, one per checkout attempt (see the idempotency notes in
    // productOrder.service.ts).
    idempotencyKey: string;
    // COD-only in this phase; only the COD member exists, so anything else is
    // rejected by validation.
    paymentMethod?: ProductPaymentMethod;
    // Exactly one of `addressId` (a saved address owned by the caller) or
    // `shippingAddress` (an inline snapshot) is required.
    addressId?: string;
    shippingAddress?: IShippingAddressSnapshot;
    customerNote?: string;
}

export interface IUpdateProductOrderStatusPayload {
    status: ProductOrderStatus;
}

export interface IUpdateProductOrderPaymentPayload {
    paymentStatus: ProductPaymentStatus;
}
