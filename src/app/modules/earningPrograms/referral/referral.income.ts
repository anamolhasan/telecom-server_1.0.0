import { Prisma, WalletTransaction } from "../../../../generated/prisma/client";
import {
    EarningProgram,
    EarningRuleScope,
    EarningRuleType,
    WalletTransactionReason,
    WalletTransactionType,
} from "../../../../generated/prisma/enums";
import { toMoneyCents } from "../../ecommerce/ecommerce.utils";
import { referralCommissionIdempotencyKey } from "../../earning/earning.rule";
import { EarningService } from "../../earning/earning.service";
import { applyWalletTransaction } from "../../wallet/wallet.utils";
import { IGrantReferralIncomePayload } from "./referral.interface";
import { ReferralService } from "./referral.service";

// Server-side gated Referral Income accrual.
// Safety properties:
//   1. Idempotent: at most one REFERRAL_INCOME ledger entry per order (guarded inside the tx).
//   2. Eligibility is re-derived live inside the transaction — never trusted from clients,
//      cached flags, or the caller.
//   3. Financial history is preserved: only new credits are appended; nothing is mutated.
//   4. The immutable earning-ledger row is written alongside the wallet credit (linked to
//      it) so the Referral program keeps its own rule snapshot and earning history. The
//      ledger row records the movement; it never makes a second one.
export const grantReferralIncome = async (
    tx: Prisma.TransactionClient,
    payload: IGrantReferralIncomePayload,
): Promise<WalletTransaction | null> => {
    const reason = payload.reason ?? WalletTransactionReason.REFERRAL_INCOME;

    const existing = await tx.walletTransaction.findFirst({
        where: { orderId: payload.orderId, reason },
    });

    if (existing) {
        return existing;
    }

    const status = await ReferralService.getReferralStatus(tx, payload.appUserId);

    if (!status.eligible) {
        return null;
    }

    const referrer = await tx.appUser.findUniqueOrThrow({
        where: { id: payload.appUserId },
    });

    const walletTransaction = await applyWalletTransaction(tx, {
        userId: referrer.authUserId,
        amount: payload.amount,
        type: WalletTransactionType.CREDIT,
        reason,
        description: `Referral income for order ${payload.orderId}`,
        orderId: payload.orderId,
    });

    await EarningService.recordRealisedEarning(tx, {
        program: EarningProgram.REFERRAL,
        appUserId: payload.appUserId,
        userId: referrer.authUserId,
        amountCents: toMoneyCents(payload.amount),
        baseAmountCents: toMoneyCents(payload.baseAmount ?? 0),
        walletReason: reason,
        // Rule snapshot: the offer's configured referral commission rate at the
        // moment the purchase completed.
        rule: {
            scope: EarningRuleScope.OPERATOR_OFFER,
            ruleType: EarningRuleType.PERCENTAGE,
            value: payload.ruleValue ?? 0,
            refId: payload.offerId ?? null,
        },
        idempotencyKey: referralCommissionIdempotencyKey(
            payload.orderId,
            payload.appUserId,
        ),
        orderId: payload.orderId,
        description: `Referral income for order ${payload.orderId}`,
        walletTransactionId: walletTransaction.id,
    });

    return walletTransaction;
};

export const ReferralIncomeService = {
    grantReferralIncome,
};
