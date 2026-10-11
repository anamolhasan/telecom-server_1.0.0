import { describe, expect, it, vi } from "vitest";
import { QueryBuilder } from "./QueryBuilder";
import type { PrismaModelDelegate } from "../interfaces/query.interface";

const createModel = (): PrismaModelDelegate => ({
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
});

describe("QueryBuilder nested relation search", () => {
    it("builds a to-one nested search condition without a list operator", () => {
        const builder = new QueryBuilder(
            createModel(),
            { searchTerm: "john" },
            { searchableFields: ["appUser.authUser.name"] },
        );

        builder.search();

        expect(builder.getQuery().where).toEqual({
            OR: [
                {
                    appUser: {
                        authUser: {
                            name: { contains: "john", mode: "insensitive" },
                        },
                    },
                },
            ],
        });
    });

    it("builds a single field search condition directly", () => {
        const builder = new QueryBuilder(
            createModel(),
            { searchTerm: "017" },
            { searchableFields: ["targetNumber"] },
        );

        builder.search();

        expect(builder.getQuery().where).toEqual({
            OR: [{ targetNumber: { contains: "017", mode: "insensitive" } }],
        });
    });
});

describe("QueryBuilder nested relation filter", () => {
    it("builds a to-one nested filter condition without a list operator", () => {
        const builder = new QueryBuilder(
            createModel(),
            { "appUser.authUser.email": "a@b.com" },
            { filterableFields: ["appUser.authUser.email"] },
        );

        builder.filter();

        expect(builder.getQuery().where).toEqual({
            appUser: { authUser: { email: "a@b.com" } },
        });
    });
});
