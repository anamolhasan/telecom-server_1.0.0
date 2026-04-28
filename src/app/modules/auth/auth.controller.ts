import { Request, Response } from "express";
import { catchAsync } from "../../shared/catchAsync";
import { AuthService } from "./auth.service";
import status from "http-status";
import { sendResponse } from "../../shared/sendResponse";

const registerAppUser = catchAsync(async (req: Request, res: Response) => {
  const payload = req.body;

  const result = await AuthService.registerUser(payload);

  const { token, ...rest } = result;

  sendResponse(res, {
    httpStatusCode: status.CREATED,
    success: true,
    message: "Patient registered successfully",
    data: {
      token,
      ...rest,
    },
  });
});


const loginUser = catchAsync (
    async (req:Request, res:Response) => {
        const payload = req.body;
        const result = await AuthService.loginUser(payload);

        const {token, ...rest} = result

        sendResponse(res, {
        httpStatusCode:status.OK,
        success:true,
        message:'User logged in successfully',
        data:{
            token,
            ...rest,
        },
       })
    }
)

export const authController = {
    registerAppUser,
}