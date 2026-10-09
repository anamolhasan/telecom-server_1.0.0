import { Prisma, WalletTransaction } from "../../../generated/prisma/client";
import {
    WalletTransactionReason,
    WalletTransactionType,
} from "../../../generated/prisma/enums";
import { applyWalletTransaction } from "../wallet/wallet.utils";
import { IGrantReferralIncomePayload } from "./referral.interface";
import { ReferralService } from "./referral.service";

// Server-side gated Referral Income accrual.
// Safety properties:
//   1. Idempotent: at most one REFERRAL_INCOME ledger entry per order (guarded inside the tx).
//   2. Eligibility is re-derived live inside the transaction — never trusted from clients,
//      cached flags, or the caller.
//   3. Financial history is preserved: only new credits are appended; nothing is mutated.
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

    return applyWalletTransaction(tx, {
        userId: referrer.authUserId,
        amount: payload.amount,
        type: WalletTransactionType.CREDIT,
        reason,
        description: `Referral income for order ${payload.orderId}`,
        orderId: payload.orderId,
    });
};

export const ReferralIncomeService = {
    grantReferralIncome,
};