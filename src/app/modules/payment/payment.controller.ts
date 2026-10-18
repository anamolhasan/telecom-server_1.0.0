import { Request, Response } from "express";
import status from "http-status";
import Stripe from "stripe";
import { envVars } from "../../config/env";
import { stripe } from "../../config/stripe.config";
import AppError from "../../errorHelpers/AppError";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { PaymentService } from "./payment.service";


const handleStripeWebhookEvent = catchAsync(async (req: Request, res: Response) => {
    const signature = req.headers["stripe-signature"] as string;

    if (!signature) {
        throw new AppError(status.BAD_REQUEST, "Missing Stripe signature");
    }

    const event = stripe.webhooks.constructEvent(
        req.body as Buffer,
        signature,
        envVars.STRIPE.STRIPE_WEBHOOK_SECRET,
    ) as Stripe.Event;

    const result = await PaymentService.handleStripeWebhookEvent(event);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: result.message,
    });
});

export const PaymentController = {
    handleStripeWebhookEvent,
};
