import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProductStatus, Role } from "../../../../generated/prisma/enums";
import { ProductService } from "./product.service";

// The service talks to Prisma (inside and outside a transaction) and to the
// Cloudinary deletion helper. All are mocked, so no database or provider
// credentials are needed.
const mocks = vi.hoisted(() => ({
    productFindFirst: vi.fn(),
    productFindMany: vi.fn(),
    productCount: vi.fn(),
    productCreate: vi.fn(),
    productUpdate: vi.fn(),
    productFindUniqueOrThrow: vi.fn(),
    imageFindMany: vi.fn(),
    imageDeleteMany: vi.fn(),
    imageCreateMany: vi.fn(),
    imageCount: vi.fn(),
    categoryFindFirst: vi.fn(),
    brandFindFirst: vi.fn(),
    transaction: vi.fn(),
    deleteImageByPublicId: vi.fn(),
}));

vi.mock("../../../lib/prisma", () => ({
    prisma: {
        product: {
            findFirst: mocks.productFindFirst,
            findMany: mocks.productFindMany,
            count: mocks.productCount,
            create: mocks.productCreate,
            update: mocks.productUpdate,
            findUniqueOrThrow: mocks.productFindUniqueOrThrow,
        },
        productImage: {
            findMany: mocks.imageFindMany,
            deleteMany: mocks.imageDeleteMany,
            createMany: mocks.imageCreateMany,
            count: mocks.imageCount,
        },
        category: { findFirst: mocks.categoryFindFirst },
        brand: { findFirst: mocks.brandFindFirst },
        $transaction: mocks.transaction,
    },
}));

vi.mock("../../upload/cloudinary.service", () => ({
    deleteImageByPublicId: mocks.deleteImageByPublicId,
}));

// Runs the transaction callback against the same mocked delegates, so the
// statements the service issues inside the transaction are observable.
const withTransaction = () => {
    mocks.transaction.mockImplementation(
        async (callback: (tx: unknown) => unknown) =>
            callback({
                product: {
                    findFirst: mocks.productFindFirst,
                    update: mocks.productUpdate,
                    findUniqueOrThrow: mocks.productFindUniqueOrThrow,
                },
                productImage: {
                    findMany: mocks.imageFindMany,
                    deleteMany: mocks.imageDeleteMany,
                    createMany: mocks.imageCreateMany,
                },
            }),
    );
};

const baseProduct = (overrides: Record<string, unknown> = {}) => ({
    id: "p1",
    name: "Smartphone",
    slug: "smartphone",
    description: "A phone",
    categoryId: "cat1",
    brandId: null,
    status: ProductStatus.DRAFT,
    isActive: false,
    isDeleted: false,
    deletedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    images: [],
    variants: [],
    category: {
        id: "cat1",
        name: "Phones",
        slug: "phones",
        isActive: true,
        isDeleted: false,
    },
    brand: null,
    ...overrides,
});

beforeEach(() => {
    vi.resetAllMocks();
    mocks.categoryFindFirst.mockResolvedValue({ id: "cat1" });
});

describe("ProductService.createProduct", () => {
    it("creates a draft and derives isActive from the status", async () => {
        mocks.productCreate.mockResolvedValue(baseProduct());

        await ProductService.createProduct({
            name: "Smartphone",
            slug: "smartphone",
            description: "A phone",
            categoryId: "cat1",
        });

        expect(mocks.productCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    status: ProductStatus.DRAFT,
                    isActive: false,
                }),
            }),
        );
    });

    it("activates a product created directly as ACTIVE", async () => {
        mocks.productCreate.mockResolvedValue(
            baseProduct({ status: ProductStatus.ACTIVE, isActive: true }),
        );

        await ProductService.createProduct({
            name: "Smartphone",
            slug: "smartphone",
            description: "A phone",
            categoryId: "cat1",
            status: ProductStatus.ACTIVE,
        });

        expect(mocks.productCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    status: ProductStatus.ACTIVE,
                    isActive: true,
                }),
            }),
        );
    });

    it("lets an explicit isActive override the status default", async () => {
        mocks.productCreate.mockResolvedValue(baseProduct());

        await ProductService.createProduct({
            name: "Smartphone",
            slug: "smartphone",
            description: "A phone",
            categoryId: "cat1",
            status: ProductStatus.ACTIVE,
            isActive: false,
        });

        expect(mocks.productCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ isActive: false }),
            }),
        );
    });

    it("numbers gallery images by their submitted order", async () => {
        mocks.productCreate.mockResolvedValue(baseProduct());

        await ProductService.createProduct({
            name: "Smartphone",
            slug: "smartphone",
            description: "A phone",
            categoryId: "cat1",
            images: [
                { url: "https://example.com/1.png", publicId: "rizqifybd/1" },
                { url: "https://example.com/2.png", position: 5 },
            ],
        });

        expect(mocks.productCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    images: {
                        create: [
                            {
                                url: "https://example.com/1.png",
                                publicId: "rizqifybd/1",
                                altText: null,
                                position: 0,
                            },
                            {
                                url: "https://example.com/2.png",
                                publicId: null,
                                altText: null,
                                position: 5,
                            },
                        ],
                    },
                }),
            }),
        );
    });

    it("rejects a missing category", async () => {
        mocks.categoryFindFirst.mockResolvedValue(null);

        await expect(
            ProductService.createProduct({
                name: "Smartphone",
                slug: "smartphone",
                description: "A phone",
                categoryId: "missing",
            }),
        ).rejects.toMatchObject({ statusCode: 404 });

        expect(mocks.productCreate).not.toHaveBeenCalled();
    });

    it("rejects a missing brand", async () => {
        mocks.brandFindFirst.mockResolvedValue(null);

        await expect(
            ProductService.createProduct({
                name: "Smartphone",
                slug: "smartphone",
                description: "A phone",
                categoryId: "cat1",
                brandId: "missing",
            }),
        ).rejects.toMatchObject({ statusCode: 404 });

        expect(mocks.productCreate).not.toHaveBeenCalled();
    });
});

describe("ProductService.getProductById visibility", () => {
    it("reports a draft as missing to a public caller", async () => {
        mocks.productFindFirst.mockResolvedValue(baseProduct());

        await expect(
            ProductService.getProductById("p1", undefined),
        ).rejects.toMatchObject({ statusCode: 404 });
    });

    it("reports a paused product as missing to a public caller", async () => {
        mocks.productFindFirst.mockResolvedValue(
            baseProduct({ status: ProductStatus.ACTIVE, isActive: false }),
        );

        await expect(
            ProductService.getProductById("p1", Role.USER),
        ).rejects.toMatchObject({ statusCode: 404 });
    });

    it("returns a draft to a content admin", async () => {
        mocks.productFindFirst.mockResolvedValue(baseProduct());

        await expect(
            ProductService.getProductById("p1", Role.ADMIN),
        ).resolves.toMatchObject({ id: "p1" });
    });

    it("never selects a soft-deleted product", async () => {
        mocks.productFindFirst.mockResolvedValue(null);

        await expect(
            ProductService.getProductById("p1", Role.SUPER_ADMIN),
        ).rejects.toMatchObject({ statusCode: 404 });

        expect(mocks.productFindFirst).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: "p1", isDeleted: false } }),
        );
    });
});

describe("ProductService.updateProduct", () => {
    it("keeps isActive in step when the status moves to ACTIVE", async () => {
        withTransaction();
        mocks.productFindFirst.mockResolvedValue(baseProduct());
        mocks.productUpdate.mockResolvedValue(baseProduct());
        mocks.productFindUniqueOrThrow.mockResolvedValue(baseProduct());

        await ProductService.updateProduct("p1", {
            status: ProductStatus.ACTIVE,
        });

        expect(mocks.productUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: "p1" },
                data: expect.objectContaining({
                    status: ProductStatus.ACTIVE,
                    isActive: true,
                }),
            }),
        );
    });

    it("leaves the gallery untouched when no images were sent", async () => {
        withTransaction();
        mocks.productFindFirst.mockResolvedValue(baseProduct());
        mocks.productUpdate.mockResolvedValue(baseProduct());
        mocks.productFindUniqueOrThrow.mockResolvedValue(baseProduct());

        await ProductService.updateProduct("p1", { name: "Renamed" });

        expect(mocks.imageFindMany).not.toHaveBeenCalled();
        expect(mocks.imageDeleteMany).not.toHaveBeenCalled();
        expect(mocks.imageCreateMany).not.toHaveBeenCalled();
        expect(mocks.deleteImageByPublicId).not.toHaveBeenCalled();
    });

    it("replaces the gallery and only deletes handles nothing else references", async () => {
        withTransaction();
        mocks.productFindFirst.mockResolvedValue(baseProduct());
        mocks.imageFindMany.mockResolvedValue([
            { url: "https://example.com/old.png", publicId: "rizqifybd/old" },
        ]);
        mocks.productUpdate.mockResolvedValue(baseProduct());
        mocks.productFindUniqueOrThrow.mockResolvedValue(
            baseProduct({
                images: [
                    {
                        id: "img2",
                        url: "https://example.com/new.png",
                        publicId: "rizqifybd/new",
                        altText: null,
                        position: 0,
                    },
                ],
            }),
        );
        mocks.imageCount.mockResolvedValue(0);

        const view = await ProductService.updateProduct("p1", {
            images: [
                { url: "https://example.com/new.png", publicId: "rizqifybd/new" },
            ],
        });

        expect(mocks.imageDeleteMany).toHaveBeenCalledWith({
            where: { productId: "p1" },
        });
        expect(mocks.imageCreateMany).toHaveBeenCalledWith({
            data: [
                {
                    url: "https://example.com/new.png",
                    publicId: "rizqifybd/new",
                    altText: null,
                    position: 0,
                    productId: "p1",
                },
            ],
        });
        expect(mocks.deleteImageByPublicId).toHaveBeenCalledWith(
            "rizqifybd/old",
        );
        expect(view.images).toHaveLength(1);
    });

    it("keeps a replaced handle that is still referenced elsewhere", async () => {
        withTransaction();
        mocks.productFindFirst.mockResolvedValue(baseProduct());
        mocks.imageFindMany.mockResolvedValue([
            { url: "https://example.com/old.png", publicId: "rizqifybd/old" },
        ]);
        mocks.productUpdate.mockResolvedValue(baseProduct());
        mocks.productFindUniqueOrThrow.mockResolvedValue(baseProduct());
        mocks.imageCount.mockResolvedValue(2);

        await ProductService.updateProduct("p1", { images: [] });

        expect(mocks.deleteImageByPublicId).not.toHaveBeenCalled();
    });

    it("rejects a missing category before opening a transaction", async () => {
        mocks.categoryFindFirst.mockResolvedValue(null);

        await expect(
            ProductService.updateProduct("p1", { categoryId: "missing" }),
        ).rejects.toMatchObject({ statusCode: 404 });

        expect(mocks.transaction).not.toHaveBeenCalled();
    });

    it("rejects an unknown product", async () => {
        withTransaction();
        mocks.productFindFirst.mockResolvedValue(null);

        await expect(
            ProductService.updateProduct("p1", { name: "Renamed" }),
        ).rejects.toMatchObject({ statusCode: 404 });

        expect(mocks.productUpdate).not.toHaveBeenCalled();
    });
});

describe("ProductService.deleteProduct", () => {
    it("archives instead of destroying the product", async () => {
        mocks.productFindFirst.mockResolvedValue(baseProduct());
        mocks.productUpdate.mockResolvedValue(
            baseProduct({
                status: ProductStatus.ARCHIVED,
                isDeleted: true,
                isActive: false,
            }),
        );

        await ProductService.deleteProduct("p1");

        expect(mocks.productUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: "p1" },
                data: expect.objectContaining({
                    isDeleted: true,
                    isActive: false,
                    status: ProductStatus.ARCHIVED,
                }),
            }),
        );
    });
});

describe("ProductService.getAllProducts visibility", () => {
    const findManyArgs = (): { where: Record<string, unknown> } =>
        mocks.productFindMany.mock.calls[0]?.[0] as {
            where: Record<string, unknown>;
        };

    const countArgs = (): { where: Record<string, unknown> } =>
        mocks.productCount.mock.calls[0]?.[0] as {
            where: Record<string, unknown>;
        };

    beforeEach(() => {
        mocks.productFindMany.mockResolvedValue([]);
        mocks.productCount.mockResolvedValue(0);
    });

    it("forces the published constraints onto a public list query", async () => {
        // A public caller passing status/isActive filters must not be able to see
        // drafts or archived rows: the forced predicate wins.
        await ProductService.getAllProducts(
            {
                page: "1",
                limit: "10",
                status: ProductStatus.DRAFT,
                isActive: "false",
                isDeleted: "true",
            },
            undefined,
        );

        expect(findManyArgs().where).toMatchObject({
            isDeleted: false,
            isActive: true,
            status: ProductStatus.ACTIVE,
        });
        expect(countArgs().where).toMatchObject({
            isDeleted: false,
            isActive: true,
            status: ProductStatus.ACTIVE,
        });
    });

    it("does not let a signed-in customer widen the catalogue", async () => {
        await ProductService.getAllProducts(
            { status: ProductStatus.DRAFT },
            Role.USER,
        );

        expect(findManyArgs().where).toMatchObject({
            status: ProductStatus.ACTIVE,
            isDeleted: false,
        });
    });

    it("lets a content admin filter on status", async () => {
        await ProductService.getAllProducts(
            { status: ProductStatus.DRAFT },
            Role.ADMIN,
        );

        expect(findManyArgs().where).toMatchObject({
            status: ProductStatus.DRAFT,
        });
    });
});
