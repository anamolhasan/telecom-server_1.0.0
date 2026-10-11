import { JwtPayload, SignOptions } from "jsonwebtoken";
import { jwtUtils } from "./jwt";
import { envVars } from "../config/env";
import { Response } from "express";
import { CookieUtils } from "./cookie";



// creating access token
const getAccessToken = (payload: JwtPayload) => {
    const accessToken = jwtUtils.createToken(
        payload,
        envVars.ACCESS_TOKEN_SECRET,
        { expiresIn: envVars.ACCESS_TOKEN_EXPIRES_IN } as SignOptions
    )
    return accessToken;
}

const getRefreshToken = (payload: JwtPayload) => {
    const refreshToken = jwtUtils.createToken(
        payload,
        envVars.REFRESH_TOKEN_SECRET,
        { expiresIn: envVars.REFRESH_TOKEN_EXPIRES_IN } as SignOptions
    )
    return refreshToken
}

const setAccessTokenCookie = (res: Response, token: string) => {
    CookieUtils.setCookie(res, 'accessToken', token, {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        path: '/',
        // 1 Day
        maxAge: 60 * 60 * 24 * 1000,
    })
}

const setRefreshTokenCookie = (res: Response, token: string) => {
    CookieUtils.setCookie(res, 'refreshToken', token, {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        path: '/',
        // 7 Day
        maxAge: 60 * 60 * 24 * 1000 * 7,
    })
}

const setBatterAuthSessionCookie = (res: Response, token: string) => {
    CookieUtils.setCookie(res, 'better-auth.session_token', token, {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        path: '/',
        // 1 Day
        maxAge: 60 * 60 * 24 * 1000,
    })
}

const clearAuthCookies = (res: Response) => {
    const options = {
        httpOnly: true,
        secure: true,
        sameSite: 'none' as const,
        path: '/',
    }

    CookieUtils.clearCookie(res, 'accessToken', options)
    CookieUtils.clearCookie(res, 'refreshToken', options)
    CookieUtils.clearCookie(res, 'better-auth.session_token', options)
}


export const tokenUtils = {
    getAccessToken,
    getRefreshToken,
    setAccessTokenCookie,
    setRefreshTokenCookie,
    setBatterAuthSessionCookie,
    clearAuthCookies,
}
