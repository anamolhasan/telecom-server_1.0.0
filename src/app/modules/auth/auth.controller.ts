import { Request, Response } from "express";
import { catchAsync } from "../../shared/catchAsync";
import { AuthService } from "./auth.service";
import status from "http-status";
import { sendResponse } from "../../shared/sendResponse";
import { tokenUtils } from "../../utils/token";
import { CookieUtils } from "../../utils/cookie";

const registerAppUser = catchAsync(async (req: Request, res: Response) => {
  const payload = req.body;

  const result = await AuthService.registerUser(payload);

  const { accessToken, refreshToken, token, ...rest } = result;

  tokenUtils.setAccessTokenCookie(res, accessToken);
  tokenUtils.setRefreshTokenCookie(res, refreshToken);
  tokenUtils.setBatterAuthSessionCookie(res, token as string);

  sendResponse(res, {
    httpStatusCode: status.CREATED,
    success: true,
    message: "User registered successfully",
    data: {
      token,
      accessToken,
      refreshToken,
      ...rest,
    },
  });
});


const loginUser = catchAsync(
  async (req: Request, res: Response) => {
    const payload = req.body;
    const result = await AuthService.loginUser(payload);

    const { accessToken, refreshToken, token, ...rest } = result

    tokenUtils.setAccessTokenCookie(res, accessToken);
    tokenUtils.setRefreshTokenCookie(res, refreshToken);
    tokenUtils.setBatterAuthSessionCookie(res, token as string);

    sendResponse(res, {
      httpStatusCode: status.OK,
      success: true,
      message: 'User logged in successfully',
      data: {
        token,
        accessToken,
        refreshToken,
        ...rest,
      },
    })
  }
)

const getMe = catchAsync(
  async (req: Request, res: Response) => {
    const user = req.user;

    const result = await AuthService.getMe(user)

    sendResponse(res, {
      httpStatusCode: status.OK,
      success: true,
      message: 'User profile fetched successfully',
      data: result
    })
  }
)

const updateMe = catchAsync(
  async (req: Request, res: Response) => {
    const user = req.user;

    const result = await AuthService.updateMe(user, req.body)

    sendResponse(res, {
      httpStatusCode: status.OK,
      success: true,
      message: 'User profile updated successfully',
      data: result
    })
  }
)

const changePassword = catchAsync(
  async (req: Request, res: Response) => {
    const sessionToken =
      CookieUtils.getCookie(req, 'better-auth.session_token') ??
      CookieUtils.getCookie(req, '__Secure-better-auth.session_token');

    const result = await AuthService.changePassword(req.body, sessionToken, req.user)

    // Revoke-and-replace: the response carries a fresh session/access/refresh
    // token, delivered as HttpOnly cookies only — never in the response body.
    tokenUtils.setAccessTokenCookie(res, result.accessToken);
    tokenUtils.setRefreshTokenCookie(res, result.refreshToken);
    tokenUtils.setBatterAuthSessionCookie(res, result.token);

    sendResponse(res, {
      httpStatusCode: status.OK,
      success: true,
      message: 'Password changed successfully',
      data: null,
    })
  }
)

const refreshTokens = catchAsync(
  async (req: Request, res: Response) => {
    const refreshToken = CookieUtils.getCookie(req, 'refreshToken');
    const sessionToken =
      CookieUtils.getCookie(req, 'better-auth.session_token') ??
      CookieUtils.getCookie(req, '__Secure-better-auth.session_token');

    const result = await AuthService.refreshTokens(refreshToken, sessionToken)

    tokenUtils.setAccessTokenCookie(res, result.accessToken);
    tokenUtils.setRefreshTokenCookie(res, result.refreshToken);
    tokenUtils.setBatterAuthSessionCookie(res, result.token);

    sendResponse(res, {
      httpStatusCode: status.OK,
      success: true,
      message: 'Tokens refreshed successfully',
      data: result
    })
  }
)

const logout = catchAsync(
  async (req: Request, res: Response) => {
    const sessionToken =
      CookieUtils.getCookie(req, 'better-auth.session_token') ??
      CookieUtils.getCookie(req, '__Secure-better-auth.session_token');

    await AuthService.logoutUser(sessionToken ? [sessionToken] : [])

    tokenUtils.clearAuthCookies(res)

    sendResponse(res, {
      httpStatusCode: status.OK,
      success: true,
      message: 'Logged out successfully',
      data: null
    })
  }
)

export const authController = {
  registerAppUser,
  loginUser,
  getMe,
  updateMe,
  changePassword,
  refreshTokens,
  logout,
}
