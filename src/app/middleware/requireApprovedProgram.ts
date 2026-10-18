import { NextFunction, Request, Response } from "express";
import status from "http-status";
import AppError from "../errorHelpers/AppError";
import { prisma } from "../lib/prisma";

export type EarningProgramName = "agent" | "affiliate" | "referral";

const APPROVED = "APPROVED";

// Program membership is derived from the persisted application row — never from a
// client-supplied flag and never from the account's system role. Every role may
// hold membership in all three programs at once, and each program is approved
// independently.
//
// Must run after `checkAuth()`.
export const requireApprovedProgram =
    (program: EarningProgramName) =>
        async (req: Request, _res: Response, next: NextFunction) => {
            try {
                const appUser = await prisma.appUser.findUnique({
                    where: { authUserId: req.user.userId },
                    select: {
                        id: true,
                        agentApplication: { select: { status: true } },
                        affiliateApplication: { select: { status: true } },
                        referralApplication: { select: { status: true } },
                    },
                });

                const applicationStatus =
                    program === "agent"
                        ? appUser?.agentApplication?.status
                        : program === "affiliate"
                            ? appUser?.affiliateApplication?.status
                            : appUser?.referralApplication?.status;

                if (!appUser || applicationStatus !== APPROVED) {
                    throw new AppError(
                        status.FORBIDDEN,
                        `Forbidden access! This requires an approved ${program} application.`,
                    );
                }

                next();
            } catch (error) {
                next(error);
            }
        };
