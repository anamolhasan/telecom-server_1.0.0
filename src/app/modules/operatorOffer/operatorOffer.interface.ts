import type {
    OperatorOfferAmountUnit,
    OperatorOfferBadge,
    OperatorOfferCommissionType,
    OperatorOfferDiscountType,
    OperatorOfferInventoryMode,
    OperatorOfferStatus,
    OperatorOfferType,
    OperatorOfferValidityUnit,
} from "../../../generated/prisma/enums";

export interface ICreateOperatorOfferPayload {
    operatorId: string;
    name: string;
    description?: string;
    offerType?: OperatorOfferType;
    amount?: number;
    amountUnit?: OperatorOfferAmountUnit;
    validityValue?: number;
    validityUnit?: OperatorOfferValidityUnit;
    regularPrice: number;
    discountType?: OperatorOfferDiscountType;
    discountValue?: number;
    companyPurchasePrice?: number;
    resellerCommissionType?: OperatorOfferCommissionType;
    resellerCommissionValue?: number;
    agentCommissionType?: OperatorOfferCommissionType;
    agentCommissionValue?: number;
    inventoryMode?: OperatorOfferInventoryMode;
    stockQuantity?: number;
    badges?: OperatorOfferBadge[];
    startsAt: Date;
    endsAt: Date;
    status?: OperatorOfferStatus;
    isActive?: boolean;
}

export type IUpdateOperatorOfferPayload = Partial<ICreateOperatorOfferPayload>;

export type OperatorOfferStatusAction = "pause" | "resume" | "archive";
