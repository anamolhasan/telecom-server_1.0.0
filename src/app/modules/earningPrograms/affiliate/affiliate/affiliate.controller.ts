import { Request, Response } from "express";
import status from "http-status";
import { EarningProgram } from "../../../../../generated/prisma/enums";
import type { IQueryParams } from "../../../../interfaces/query.interface";
import { catchAsync } from "../../../../shared/catchAsync";
import { sendResponse } from "../../../../shared/sendResponse";
import { EarningService } from "../../../earning/earning.service";
import { AffiliateService } from "./affiliate.service";
import type {
    ICreateAffiliateLinkPayload,
    ITrackAffiliateVisitPayload,
    IUpdateAffiliateLinkPayload,
} from "./affiliate.interface";

// Readable by any authenticated account so a pending applicant can see where the
// Affiliate application stands; the figures stay at zero until it is approved.
const getAffiliateDashboard = catchAsync(async (req: Request, res: Response) => {
    const result = await AffiliateService.getAffiliateDashboard(req.user!);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Affiliate dashboard fetched successfully",
        data: result,
    });
});

const createAffiliateLink = catchAsync(async (req: Request, res: Response) => {
    const result = await AffiliateService.createLink(
        req.user!,
        req.body as ICreateAffiliateLinkPayload,
    );

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Affiliate link created successfully",
        data: result,
    });
});

const getMyAffiliateLinks = catchAsync(async (req: Request, res: Response) => {
    const result = await AffiliateService.getMyLinks(
        req.user!,
        req.query as IQueryParams,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Affiliate links fetched successfully",
        data: result.data,
        meta: result.meta,
    });
});

const updateMyAffiliateLink = catchAsync(async (req: Request, res: Response) => {
    const result = await AffiliateService.updateMyLink(
        req.user!,
        req.params.id as string,
        req.body as IUpdateAffiliateLinkPayload,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Affiliate link updated successfully",
        data: result,
    });
});

// Records a visit and, the first time, the permanent attribution. Any
// authenticated customer may call this — attribution targets a customer, not an
// affiliate.
const trackAffiliateVisit = catchAsync(async (req: Request, res: Response) => {
    const result = await AffiliateService.trackVisit(
        req.user!,
        req.body as ITrackAffiliateVisitPayload,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: result.attributed
            ? "Affiliate attribution recorded"
            : "Affiliate attribution unchanged",
        data: result,
    });
});

const getMyConversions = catchAsync(async (req: Request, res: Response) => {
    const result = await AffiliateService.getMyConversions(
        req.user!,
        req.query as IQueryParams,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Affiliate conversions fetched successfully",
        data: result.data,
        meta: result.meta,
    });
});

// The Affiliate program's own earning history; the program is forced server-side
// so this can never return another program's earnings.
const getMyAffiliateEarnings = catchAsync(async (req: Request, res: Response) => {
    const result = await EarningService.getMyEarnings(
        req.user!,
        req.query as IQueryParams,
        { program: EarningProgram.AFFILIATE },
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Affiliate earnings fetched successfully",
        data: result.data,
        meta: result.meta,
    });
});

export const AffiliateController = {
    getAffiliateDashboard,
    createAffiliateLink,
    getMyAffiliateLinks,
    updateMyAffiliateLink,
    trackAffiliateVisit,
    getMyConversions,
    getMyAffiliateEarnings,
};
