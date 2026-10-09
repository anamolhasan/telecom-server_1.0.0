import status from "http-status";
import { Product } from "../../../generated/prisma/client";
import AppError from "../../errorHelpers/AppError";
import { IQueryParams, PrismaModelDelegate } from "../../interfaces/query.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { ICreateProductPayload, IUpdateProductPayload } from "./product.interface";


const ensureOperatorExists = async (operatorId: string) => {
    const operator = await prisma.operator.findFirst({
        where: { id: operatorId, isDeleted: false },
    });

    if (!operator) {
        throw new AppError(status.NOT_FOUND, "Operator not found");
    }
};

const createProduct = async (payload: ICreateProductPayload) => {
    await ensureOperatorExists(payload.operatorId);
    return prisma.product.create({ data: payload });
};

const getAllProducts = async (query: IQueryParams) => {
    const queryBuilder = new QueryBuilder<Product>(
        prisma.product as unknown as PrismaModelDelegate,
        query,
        {
            searchableFields: ["name", "operator.name"],
            filterableFields: ["operatorId", "type", "isActive", "isDeleted"],
        },
    );

    return queryBuilder
        .search()
        .filter()
        .include({ operator: true })
        .sort()
        .paginate()
        .fields()
        .execute();
};

const getProductById = async (id: string) => {
    const product = await prisma.product.findFirst({
        where: { id, isDeleted: false },
        include: { operator: true },
    });

    if (!product) {
        throw new AppError(status.NOT_FOUND, "Product not found");
    }

    return product;
};

const updateProduct = async (id: string, payload: IUpdateProductPayload) => {
    await getProductById(id);

    if (payload.operatorId) {
        await ensureOperatorExists(payload.operatorId);
    }

    return prisma.product.update({ where: { id }, data: payload });
};

const deleteProduct = async (id: string) => {
    await getProductById(id);
    return prisma.product.update({
        where: { id },
        data: { isDeleted: true, deletedAt: new Date() },
    });
};

export const ProductService = {
    createProduct,
    getAllProducts,
    getProductById,
    updateProduct,
    deleteProduct,
};
