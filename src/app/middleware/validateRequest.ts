import { NextFunction, Request, Response } from "express";
import z from "zod";



export const validateRequest = <T extends z.ZodType>(zodSchema: T) => {
    return (req: Request, res: Response, next: NextFunction) => {

        if (req.body.data) {
            req.body = JSON.parse(req.body.data)
        }

        const parsedResult = zodSchema.safeParse(req.body)

        if (!parsedResult.success) {
            next(parsedResult.error)
            return
        }

        req.body = parsedResult.data

        next()
    }
}
