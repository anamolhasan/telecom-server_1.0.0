import { OrderStatus, PaymentStatus } from "../../../generated/prisma/enums";

// A transaction is an agent SALE only when a distinct seller is attached to the
// order (Order.sellerId set and different from the buyer). Everything else is a
// personal PURCHASE. The classification is derived from the order data — the
// acting user's role is never consulted.
export type OrderActorType = "AGENT_SALE" | "PURCHASE";

export const classifyOrderActor = (
    sellerId: string | null | undefined,
    buyerId: string,
): OrderActorType =>
    sellerId !== null && sellerId !== undefined && sellerId !== "" && sellerId !== buyerId
        ? "AGENT_SALE"
        : "PURCHASE";

export interface IOrderSuccessState {
    status: OrderStatus;
    paymentStatus: PaymentStatus;
}

// Commissions are only ever awarded for a successful order: delivered (COMPLETED)
// and paid. Pending, processing, working, cancelled, failed and refunded orders
// never qualify.
export const isSuccessfulOrder = (order: IOrderSuccessState): boolean =>
    order.status === OrderStatus.COMPLETED &&
    order.paymentStatus === PaymentStatus.PAID;

export interface ICommissionIntentInput {
    actorType: OrderActorType;
    sellerCanEarn: boolean;
    agentCommissionAmount: number;
    referralCommissionAmount: number;
}

export interface ICommissionIntent {
    agentAmount: number;
    referralAmount: number;
}

// Agent commission applies only to a sale whose seller is an authorized agent.
// Referral commission applies only to a personal purchase (never to a sale) and
// is paid to the buyer's eligible referrer. Amounts are always the server-computed
// order values; callers never supply their own.
export const resolveCommissionIntent = (
    input: ICommissionIntentInput,
): ICommissionIntent => {
    const agentAmount =
        input.actorType === "AGENT_SALE" &&
        input.sellerCanEarn &&
        input.agentCommissionAmount > 0
            ? input.agentCommissionAmount
            : 0;

    const referralAmount =
        input.actorType === "PURCHASE" && input.referralCommissionAmount > 0
            ? input.referralCommissionAmount
            : 0;

    return { agentAmount, referralAmount };
};
