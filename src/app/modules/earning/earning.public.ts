import type { EarningTransaction } from "../../../generated/prisma/client";
import {
    EarningProgram,
    EarningRuleScope,
    EarningRuleType,
    EarningStatus,
} from "../../../generated/prisma/enums";
import { toNullableMoneyNumber, toMoneyNumber } from "../ecommerce/ecommerce.utils";

// Public shape of an earning. Deliberately omits `appUserId`, `userId`,
// `walletTransactionId`, `commissionRuleId` and `idempotencyKey`: a beneficiary
// only ever needs to see their own earning, and internal keys must never leave
// the server.
export interface IEarningView {
    id: string;
    program: EarningProgram;
    status: EarningStatus;
    amount: number;
    currency: string;
    ruleType: EarningRuleType;
    ruleValue: number;
    ruleScope: EarningRuleScope;
    baseAmount: number;
    description: string | null;
    orderId: string | null;
    productOrderId: string | null;
    availableAt: Date | null;
    reversedAt: Date | null;
    createdAt: Date;
}

export interface ICommissionRuleView {
    id: string;
    program: EarningProgram;
    scope: EarningRuleScope;
    ruleType: EarningRuleType;
    value: number;
    productId: string | null;
    productVariantId: string | null;
    operatorOfferId: string | null;
    isActive: boolean;
    priority: number;
    note: string | null;
    createdAt: Date;
    updatedAt: Date;
}

export const toPublicEarning = (earning: EarningTransaction): IEarningView => ({
    id: earning.id,
    program: earning.program,
    status: earning.status,
    amount: toMoneyNumber(earning.amount),
    currency: earning.currency,
    ruleType: earning.ruleType,
    ruleValue: toMoneyNumber(earning.ruleValue),
    ruleScope: earning.ruleScope,
    baseAmount: toMoneyNumber(earning.baseAmount),
    description: earning.description,
    orderId: earning.orderId,
    productOrderId: earning.productOrderId,
    availableAt: earning.availableAt,
    reversedAt: earning.reversedAt,
    createdAt: earning.createdAt,
});

export const toPublicEarnings = (
    earnings: EarningTransaction[],
): IEarningView[] => earnings.map(toPublicEarning);

export const toCommissionRuleView = (rule: {
    id: string;
    program: EarningProgram;
    scope: EarningRuleScope;
    ruleType: EarningRuleType;
    value: unknown;
    productId: string | null;
    productVariantId: string | null;
    operatorOfferId: string | null;
    isActive: boolean;
    priority: number;
    note: string | null;
    createdAt: Date;
    updatedAt: Date;
}): ICommissionRuleView => ({
    id: rule.id,
    program: rule.program,
    scope: rule.scope,
    ruleType: rule.ruleType,
    value: toNullableMoneyNumber(rule.value) ?? 0,
    productId: rule.productId,
    productVariantId: rule.productVariantId,
    operatorOfferId: rule.operatorOfferId,
    isActive: rule.isActive,
    priority: rule.priority,
    note: rule.note,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
});

export const toCommissionRuleViews = (
    rules: Parameters<typeof toCommissionRuleView>[0][],
): ICommissionRuleView[] => rules.map(toCommissionRuleView);
