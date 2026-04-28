import status from "http-status";
import { Specialty } from "../../../generated/prisma/client";
import AppError from "../../errorHelpers/AppError";
import { prisma } from "../../lib/prisma";

const createSpecialty = async (payload:Specialty):Promise<Specialty> => {

    const specialty = await prisma.specialty.create({
        data:payload
    })

    return specialty
}

const updateSpecialty = async (
     payload: Partial<Specialty>,
  id: string
):Promise<Specialty> => {
  const specialty = await prisma.specialty.findUnique({
    where:{id}
  });
  if(!specialty){
    throw new AppError(status.NOT_FOUND,'Specialty not found')
  }
  
  const result = await prisma.specialty.update({
    where:{id},
    data:payload
  })
  return result
}

const getAllSpecialties = async (): Promise<Specialty[]> => {

    const specialties = await prisma.specialty.findMany()

    return specialties;
}



const deleteSpecialty = async (id:string) :Promise<Specialty> => {
    const specialty = await prisma.specialty.delete({
        where:{id}
    })

    return specialty
}

export const SpecialtyService = {
    createSpecialty,
    getAllSpecialties, 
    deleteSpecialty,
    updateSpecialty
}