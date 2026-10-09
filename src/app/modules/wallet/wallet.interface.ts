import { WalletTransactionReason, WalletTransactionType } from "../../../generated/prisma/enums";

export interface IAdjustWalletPayload {
    userId: string;
    amount: number;
    type: WalletTransactionType;
    reason?: WalletTransactionReason;
    description?: string;
}
