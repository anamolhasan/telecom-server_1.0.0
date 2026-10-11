import { Role } from "../../../generated/prisma/enums";

export interface IDefaultReferralReferrer {
    name: string;
    email: string;
    role: Role;
}

export interface IDefaultReferralSetting {
    referralCode: string | null;
    referrer: IDefaultReferralReferrer | null;
}

export interface IUpdateDefaultReferralSettingPayload {
    referralCode: string;
}