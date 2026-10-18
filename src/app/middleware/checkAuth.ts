import { NextFunction, Request, Response } from "express";
import status from "http-status";
import { Role, UserStatus } from "../../generated/prisma/enums";
import AppError from "../errorHelpers/AppError";
import { prisma } from "../lib/prisma";
import { CookieUtils } from "../utils/cookie";
import { jwtUtils } from "../utils/jwt";
import { envVars } from "../config/env";


export const checkAuth =
    (...authRoles: Role[]) =>
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const sessionToken =
                    CookieUtils.getCookie(req, "better-auth.session_token") ??
                    CookieUtils.getCookie(req, "__Secure-better-auth.session_token");

                if (!sessionToken) {
                    throw new AppError(status.UNAUTHORIZED, "Unauthorized access! No session token provided.");
                }

                const sessionExists = await prisma.session.findFirst({
                    where: {
                        token: sessionToken,
                        expiresAt: {
                            gt: new Date(),
                        },
                    },
                    include: {
                        user: true,
                    },
                });

                if (!sessionExists || !sessionExists.user) {
                    throw new AppError(status.UNAUTHORIZED, "Unauthorized access! Invalid or expired session.");
                }

                const user = sessionExists.user;

                const now = new Date();
                const expiresAt = new Date(sessionExists.expiresAt);
                const createdAt = new Date(sessionExists.createdAt);

                const sessionLifeTime = expiresAt.getTime() - createdAt.getTime();
                const timeRemaining = expiresAt.getTime() - now.getTime();
                const percentRemaining = (timeRemaining / sessionLifeTime) * 100;

                if (percentRemaining < 20) {
                    res.setHeader("X-Session-Refresh", "true");
                    res.setHeader("X-Session-Expires-At", expiresAt.toISOString());
                    res.setHeader("X-Time-Remaining", timeRemaining.toString());
                }

                if (user.status === UserStatus.BLOCKED || user.status === UserStatus.DELETED) {
                    throw new AppError(status.UNAUTHORIZED, "Unauthorized access! User is not active.");
                }

                if (user.isDeleted) {
                    throw new AppError(status.UNAUTHORIZED, "Unauthorized access! User is deleted.");
                }

                const accessToken = CookieUtils.getCookie(req, "accessToken");

                if (!accessToken) {
                    throw new AppError(status.UNAUTHORIZED, "Unauthorized access! No access token provided.");
                }

                const verifiedToken = jwtUtils.verifyToken(accessToken, envVars.ACCESS_TOKEN_SECRET);

                if (!verifiedToken.success) {
                    throw new AppError(status.UNAUTHORIZED, "Unauthorized access! Invalid access token.");
                }

                if (authRoles.length > 0 && !authRoles.includes(verifiedToken.data.role as Role)) {
                    throw new AppError(status.FORBIDDEN, "Forbidden access! You do not have permission to access this resource.");
                }

                req.user = {
                    userId: user.id,
                    role: user.role,
                    email: user.email,
                };

                next();
            } catch (error) {
                next(error);
            }
        };

// Best-effort authentication for public endpoints that additionally serve
// richer data to authenticated content admins. Unlike checkAuth it never
// rejects the request: when there is no valid session (or the lookup fails)
// `req.user` is simply left unset and the request continues as anonymous.
export const checkAuthOptional = async (
    req: Request,
    res: Response,
    next: NextFunction,
) => {
    try {
        const sessionToken =
            CookieUtils.getCookie(req, "better-auth.session_token") ??
            CookieUtils.getCookie(req, "__Secure-better-auth.session_token");

        if (!sessionToken) {
            return next();
        }

        const sessionExists = await prisma.session.findFirst({
            where: {
                token: sessionToken,
                expiresAt: {
                    gt: new Date(),
                },
            },
            include: {
                user: true,
            },
        });

        if (!sessionExists || !sessionExists.user) {
            return next();
        }

        const user = sessionExists.user;

        if (
            user.status === UserStatus.BLOCKED ||
            user.status === UserStatus.DELETED ||
            user.isDeleted
        ) {
            return next();
        }

        const accessToken = CookieUtils.getCookie(req, "accessToken");

        if (!accessToken) {
            return next();
        }

        const verifiedToken = jwtUtils.verifyToken(
            accessToken,
            envVars.ACCESS_TOKEN_SECRET,
        );

        if (!verifiedToken.success) {
            return next();
        }

        req.user = {
            userId: user.id,
            role: user.role,
            email: user.email,
        };
    } catch {
        // Public endpoints must stay reachable even if the auth lookup fails.
    }

    next();
};
