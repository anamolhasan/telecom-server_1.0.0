import {
    EarningProgram,
    EarningRuleScope,
    EarningRuleType,
    WalletTransactionReason,
} from "../../../generated/prisma/enums";

// The rule that prices one earning event. Supplied by the program service, never
// by a client. `value` is BDT for FIXED and a percent for PERCENTAGE.
export interface IEarningRuleInput {
    scope: EarningRuleScope;
    ruleType: EarningRuleType;
    value: number | string;
    refId?: string | null;
    commissionRuleId?: string | null;
}

// Everything needed to record one immutable earning. `idempotencyKey` is the
// caller's stable derivation for the source event (order, milestone, conversion),
// so a repeat of the same event resolves to the existing earning.
export interface IAwardEarningPayload {
    program: EarningProgram;
    appUserId: string;
    userId: string;
    amountCents: number;
    baseAmountCents: number;
    rule: IEarningRuleInput;
    idempotencyKey: string;
    walletReason?: WalletTransactionReason;
    orderId?: string | null;
    productOrderId?: string | null;
    description?: string | null;
    currency?: string;
    // Defaults to true: the caller only records an earning at the qualifying
    // event, at which point the money is genuinely available. Pass false to
    // record a PENDING earning that is realised later.
    availableImmediately?: boolean;
}

export interface ICommissionRulePayload {
    program: EarningProgram;
    scope: EarningRuleScope;
    ruleType: EarningRuleType;
    value: number;
    productId?: string;
    productVariantId?: string;
    operatorOfferId?: string;
    isActive?: boolean;
    priority?: number;
    note?: string;
}

export interface IUpdateCommissionRulePayload {
    ruleType?: EarningRuleType;
    value?: number;
    isActive?: boolean;
    priority?: number;
    note?: string;
}

export interface IEarningProgramSummary {
    program: EarningProgram;
    pending: number;
    available: number;
    reversed: number;
    totalEarned: number;
}

export interface IEarningSummary {
    programs: IEarningProgramSummary[];
    pendingTotal: number;
    availableTotal: number;
    reversedTotal: number;
    walletBalance: number;
    totalEarned: number;
}

