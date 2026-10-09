import status from "http-status";
import { Operator } from "../../../generated/prisma/client";
import AppError from "../../errorHelpers/AppError";
import { IQueryParams, PrismaModelDelegate } from "../../interfaces/query.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { ICreateOperatorPayload, IUpdateOperatorPayload } from "./operator.interface";


const createOperator = async (payload: ICreateOperatorPayload) => {
    return prisma.operator.create({ data: payload });
};

const getAllOperators = async (query: IQueryParams) => {
    const queryBuilder = new QueryBuilder<Operator>(
        prisma.operator as unknown as PrismaModelDelegate,
        query,
        {
            searchableFields: ["name", "code"],
            filterableFields: ["isActive", "isDeleted"],
        },
    );

    return queryBuilder.search().filter().sort().paginate().fields().execute();
};

const getOperatorById = async (id: string) => {
    const operator = await prisma.operator.findFirst({
        where: { id, isDeleted: false },
    });

    if (!operator) {
        throw new AppError(status.NOT_FOUND, "Operator not found");
    }

    return operator;
};

const updateOperator = async (id: string, payload: IUpdateOperatorPayload) => {
    await getOperatorById(id);
    return prisma.operator.update({ where: { id }, data: payload });
};

const deleteOperator = async (id: string) => {
    await getOperatorById(id);
    return prisma.operator.update({
        where: { id },
        data: { isDeleted: true, deletedAt: new Date() },
    });
};

export const OperatorService = {
    createOperator,
    getAllOperators,
    getOperatorById,
    updateOperator,
    deleteOperator,
};
