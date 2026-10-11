import { NextFunction, Request, Response } from "express";
import status from "http-status";
import { ReferralApplicationStatus } from "../../generated/prisma/enums";
import AppError from "../errorHelpers/AppError";
import { prisma } from "../lib/prisma";

// Partner access is derived from the persisted referral application status, never
// from a client-supplied flag. Must run after checkAuth(...CUSTOMER_ROLES).
export const requireReferralPartner = async (
    req: Request,
    _res: Response,
    next: NextFunction,
) => {
    try {
        const application = await prisma.referralApplication.findFirst({
            where: {
                appUser: { authUserId: req.user.userId },
            },
            select: { status: true },
        });

        if (!application || application.status !== ReferralApplicationStatus.APPROVED) {
            throw new AppError(
                status.FORBIDDEN,
                "Forbidden access! Referral partner access requires an approved referral application.",
            );
        }

        next();
    } catch (error) {
        next(error);
    }
};
