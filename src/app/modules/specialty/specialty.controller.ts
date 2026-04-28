import { Request, Response } from "express"
import { catchAsync } from "../../shared/catchAsync"
import { SpecialtyService } from "./specialty.service"
import { sendResponse } from "../../shared/sendResponse"
import { Specialty } from "../../../generated/prisma/client"

const createSpecialty = catchAsync(
    async(req:Request, res:Response) => {

        const payload = {
            ...req.body,
            // icon:req.file?.path
        }
      
        const result = await SpecialtyService.createSpecialty(payload)

        sendResponse(res, {
            httpStatusCode:201,
            success:true,
            message:'Specialty created successfully',
            data:result
        })
    }
)

const updateSpecialty = catchAsync(
    async (req:Request, res:Response) => {
     const payload: Partial<Specialty> = req.body
     const id = req.params.id

     const result = await SpecialtyService.updateSpecialty(payload, id as string)

     sendResponse(res,{
        httpStatusCode:200,
        success:true,
        message:'Specialty update successfully',
        data:result
     })
    }
)

const getAllSpecialties = catchAsync(
    async (req:Request, res:Response) => {
        const result = await SpecialtyService.getAllSpecialties();
        sendResponse(res,{
            httpStatusCode:200,
            success:true,
            message:'Specialties fetched successfully',
            data:result
        })
    }
)



const deleteSpecialty = catchAsync(
    async (req:Request, res:Response) => {
        const {id} = req.params;
        const result = await SpecialtyService.deleteSpecialty(id as string);
        sendResponse(res, {
            httpStatusCode:200,
            success:true,
            message:'Specialty deleted successfully',
            data:result
        })
    }
)

export const SpecialtyController = {
    createSpecialty,
    getAllSpecialties,
    deleteSpecialty,
    updateSpecialty
}