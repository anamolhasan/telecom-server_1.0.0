// Money helpers shared by the e-commerce catalog and cart modules.
//
// Prices are stored as Prisma Decimal(12, 2) (see productVariant.prisma).
// Responses keep the numeric shape the existing modules expose
// (OperatorOfferService.serializeOperatorOffer), while any total is summed in
// integer paisa so 2-decimal money never drifts through float arithmetic.

const decimalToNumber = (value: unknown): number => {
    if (value === null || value === undefined) return 0;
    if (typeof value === "number") return value;
    if (typeof value === "string") return Number(value);

    const candidate = value as { toNumber?: () => number };
    if (typeof candidate.toNumber === "function") {
        return candidate.toNumber();
    }

    return Number(value);
};

export const toMoneyNumber = (value: unknown): number => decimalToNumber(value);

export const toNullableMoneyNumber = (value: unknown): number | null =>
    value === null || value === undefined ? null : decimalToNumber(value);

// Exact 2-decimal arithmetic in integer paisa.
export const toMoneyCents = (value: unknown): number =>
    Math.round(decimalToNumber(value) * 100);

export const centsToMoney = (cents: number): number => Math.round(cents) / 100;
