import type { OperatorOffer } from "../../../../generated/prisma/client";
import type {
    OperatorOfferAmountUnit,
    OperatorOfferBadge,
    OperatorOfferDiscountType,
    OperatorOfferInventoryMode,
    OperatorOfferStatus,
    OperatorOfferType,
    OperatorOfferValidityUnit,
    ProductType,
} from "../../../../generated/prisma/enums";

// Public subset of an Operator's fields. Operators have no commercial columns,
// but the projection is still an explicit allowlist so new internal columns are
// never exposed by accident.
export interface IPublicOperator {
    id: string;
    name: string;
    code: string;
    logo: string | null;
    isActive: boolean;
}

// Prisma model types omit relations, so the (optionally included) operator
// relation is expressed explicitly for the serializer input.
export type OperatorOfferWithOperator = OperatorOffer & {
    operator?: {
        id: string;
        name: string;
        code: string;
        logo: string | null;
        isActive: boolean;
    } | null;
};

// The public, unauthenticated projection of an operator offer. It is built by
// copying an explicit allowlist of fields, so internal commercial data
// (company purchase cost, reseller/agent commission configuration and the
// derived commission/referral rates) can never leak through public reads, even
// if new commercial columns are added to the model later.
export interface IPublicOperatorOffer {
    id: string;
    operatorId: string;
    name: string;
    description: string | null;
    offerType: OperatorOfferType;
    type: ProductType;
    amount: number | null;
    amountUnit: OperatorOfferAmountUnit | null;
    validityValue: number | null;
    validityUnit: OperatorOfferValidityUnit | null;
    regularPrice: number;
    price: number;
    discountType: OperatorOfferDiscountType;
    discountValue: number;
    inventoryMode: OperatorOfferInventoryMode;
    stockQuantity: number | null;
    badges: OperatorOfferBadge[];
    startsAt: Date | null;
    endsAt: Date | null;
    status: OperatorOfferStatus;
    isActive: boolean;
    isDeleted: boolean;
    deletedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    operator?: IPublicOperator | null;
}

function toPublicOperator(
    operator: OperatorOfferWithOperator["operator"],
): IPublicOperator | null {
    if (!operator) {
        return null;
    }

    return {
        id: operator.id,
        name: operator.name,
        code: operator.code,
        logo: operator.logo ?? null,
        isActive: operator.isActive,
    };
}

export function toPublicOperatorOffer(
    offer: OperatorOfferWithOperator,
): IPublicOperatorOffer {
    return {
        id: offer.id,
        operatorId: offer.operatorId,
        name: offer.name,
        description: offer.description ?? null,
        offerType: offer.offerType,
        type: offer.type,
        amount: offer.amount ?? null,
        amountUnit: offer.amountUnit ?? null,
        validityValue: offer.validityValue ?? null,
        validityUnit: offer.validityUnit ?? null,
        regularPrice: Number(offer.regularPrice),
        price: Number(offer.price),
        discountType: offer.discountType,
        discountValue: Number(offer.discountValue),
        inventoryMode: offer.inventoryMode,
        stockQuantity: offer.stockQuantity ?? null,
        badges: offer.badges ?? [],
        startsAt: offer.startsAt ?? null,
        endsAt: offer.endsAt ?? null,
        status: offer.status,
        isActive: offer.isActive,
        isDeleted: offer.isDeleted,
        deletedAt: offer.deletedAt ?? null,
        createdAt: offer.createdAt,
        updatedAt: offer.updatedAt,
        operator: toPublicOperator(offer.operator),
    };
}

export function toPublicOperatorOffers(
    offers: OperatorOfferWithOperator[],
): IPublicOperatorOffer[] {
    return offers.map((offer) => toPublicOperatorOffer(offer));
}
