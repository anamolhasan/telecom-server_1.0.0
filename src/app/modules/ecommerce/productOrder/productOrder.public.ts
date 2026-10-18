import type {
    ProductOrder,
    ProductOrderItem,
} from "../../../../generated/prisma/client";
import type {
    ProductOrderStatus,
    ProductPaymentMethod,
    ProductPaymentStatus,
} from "../../../../generated/prisma/enums";
import { toMoneyNumber } from "../ecommerce.utils";

export type ProductOrderWithItems = ProductOrder & {
    items?: ProductOrderItem[];
};

export interface IProductOrderShippingView {
    recipientName: string;
    phone: string;
    division: string;
    district: string;
    upazila: string | null;
    unionArea: string | null;
    villageRoad: string | null;
    postalCode: string | null;
}

export interface IProductOrderItemView {
    id: string;
    productId: string | null;
    variantId: string | null;
    productName: string;
    variantName: string | null;
    sku: string;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
}

// Customer-facing order. Money is serialized to numbers (the convention the
// other e-commerce/catalog modules use), and `userId`/`idempotencyKey` are
// deliberately absent: a buyer knows it is their own order, and the idempotency
// key is an internal request-tracing detail.
export interface IProductOrderView {
    id: string;
    orderNumber: string;
    status: ProductOrderStatus;
    paymentMethod: ProductPaymentMethod;
    paymentStatus: ProductPaymentStatus;
    paidAt: Date | null;
    subtotal: number;
    discountAmount: number;
    shippingAmount: number;
    grandTotal: number;
    currency: string;
    shippingAddress: IProductOrderShippingView;
    customerNote: string | null;
    items: IProductOrderItemView[];
    createdAt: Date;
    updatedAt: Date;
}

// Staff view: adds the owning account so an operator can identify the buyer.
export interface IAdminProductOrderView extends IProductOrderView {
    userId: string;
}

const toShippingView = (
    order: ProductOrder,
): IProductOrderShippingView => ({
    recipientName: order.shippingRecipientName,
    phone: order.shippingPhone,
    division: order.shippingDivision,
    district: order.shippingDistrict,
    upazila: order.shippingUpazila,
    unionArea: order.shippingUnionArea,
    villageRoad: order.shippingVillageRoad,
    postalCode: order.shippingPostalCode,
});

const toItemView = (item: ProductOrderItem): IProductOrderItemView => ({
    id: item.id,
    productId: item.productId,
    variantId: item.variantId,
    // Purchase-time snapshots: these values are what the customer actually
    // bought, even if the catalog row was renamed, repriced or deleted since.
    productName: item.productName,
    variantName: item.variantName,
    sku: item.sku,
    unitPrice: toMoneyNumber(item.unitPrice),
    quantity: item.quantity,
    lineTotal: toMoneyNumber(item.lineTotal),
});

const toBaseView = (order: ProductOrderWithItems): IProductOrderView => ({
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    paidAt: order.paidAt,
    subtotal: toMoneyNumber(order.subtotal),
    discountAmount: toMoneyNumber(order.discountAmount),
    shippingAmount: toMoneyNumber(order.shippingAmount),
    grandTotal: toMoneyNumber(order.grandTotal),
    currency: order.currency,
    shippingAddress: toShippingView(order),
    customerNote: order.customerNote,
    items: (order.items ?? []).map(toItemView),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
});

export const toPublicProductOrder = (
    order: ProductOrderWithItems,
): IProductOrderView => toBaseView(order);

export const toAdminProductOrder = (
    order: ProductOrderWithItems,
): IAdminProductOrderView => ({
    ...toBaseView(order),
    userId: order.userId,
});

export const toPublicProductOrders = (
    orders: ProductOrderWithItems[],
): IProductOrderView[] => orders.map(toPublicProductOrder);

export const toAdminProductOrders = (
    orders: ProductOrderWithItems[],
): IAdminProductOrderView[] => orders.map(toAdminProductOrder);
