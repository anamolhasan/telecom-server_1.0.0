import { WithdrawalMethod, WithdrawalStatus } from "../../../generated/prisma/enums";

export interface ICreateWithdrawalPayload {
    amount: number;
    method: WithdrawalMethod;
    accountNumber: string;
    accountName?: string;
}

export interface IUpdateWithdrawalStatusPayload {
    status: WithdrawalStatus;
    adminNote?: string;
}
