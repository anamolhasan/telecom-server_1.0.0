import { describe, expect, it } from "vitest";
import { OrderStatus, PaymentStatus } from "../../../generated/prisma/enums";
import {
    classifyOrderActor,
    isSuccessfulOrder,
    resolveCommissionIntent,
} from "./commission.rule";

describe("classifyOrderActor", () => {
    it("classifies an order with a distinct seller as an agent sale", () => {
        expect(classifyOrderActor("seller-1", "buyer-1")).toBe("AGENT_SALE");
    });

    it("classifies a self-order as a purchase", () => {
        expect(classifyOrderActor("user-1", "user-1")).toBe("PURCHASE");
    });

    it("classifies a missing seller as a purchase", () => {
        expect(classifyOrderActor(null, "user-1")).toBe("PURCHASE");
    });

    it("classifies a blank seller as a purchase", () => {
        expect(classifyOrderActor("", "user-1")).toBe("PURCHASE");
    });
});

describe("isSuccessfulOrder", () => {
    it("is true only when completed and paid", () => {
        expect(
            isSuccessfulOrder({
                status: OrderStatus.COMPLETED,
                paymentStatus: PaymentStatus.PAID,
            }),
        ).toBe(true);
    });

    it.each([
        { status: OrderStatus.PENDING, paymentStatus: PaymentStatus.PAID },
        { status: OrderStatus.PROCESSING, paymentStatus: PaymentStatus.PAID },
        { status: OrderStatus.WORKING, paymentStatus: PaymentStatus.PAID },
        { status: OrderStatus.COMPLETED, paymentStatus: PaymentStatus.PENDING },
        { status: OrderStatus.COMPLETED, paymentStatus: PaymentStatus.FAILED },
        { status: OrderStatus.COMPLETED, paymentStatus: PaymentStatus.REFUNDED },
        { status: OrderStatus.CANCELLED, paymentStatus: PaymentStatus.PAID },
        { status: OrderStatus.FAILED, paymentStatus: PaymentStatus.PAID },
    ])(
        "is false for $status/$paymentStatus",
        ({ status, paymentStatus }) => {
            expect(isSuccessfulOrder({ status, paymentStatus })).toBe(false);
        },
    );
});

describe("resolveCommissionIntent", () => {
    it("awards the agent commission for a sale by an authorised seller", () => {
        expect(
            resolveCommissionIntent({
                actorType: "AGENT_SALE",
                sellerCanEarn: true,
                agentCommissionAmount: 25,
                referralCommissionAmount: 5,
            }),
        ).toEqual({ agentAmount: 25, referralAmount: 0 });
    });

    it("awards nothing for a sale by an unauthorised seller", () => {
        expect(
            resolveCommissionIntent({
                actorType: "AGENT_SALE",
                sellerCanEarn: false,
                agentCommissionAmount: 25,
                referralCommissionAmount: 5,
            }),
        ).toEqual({ agentAmount: 0, referralAmount: 0 });
    });

    it("awards only the referral commission for a purchase", () => {
        expect(
            resolveCommissionIntent({
                actorType: "PURCHASE",
                sellerCanEarn: true,
                agentCommissionAmount: 25,
                referralCommissionAmount: 5,
            }),
        ).toEqual({ agentAmount: 0, referralAmount: 5 });
    });

    it("ignores zero amounts", () => {
        expect(
            resolveCommissionIntent({
                actorType: "AGENT_SALE",
                sellerCanEarn: true,
                agentCommissionAmount: 0,
                referralCommissionAmount: 0,
            }),
        ).toEqual({ agentAmount: 0, referralAmount: 0 });
    });
});
