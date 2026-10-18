import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "../../../../generated/prisma/enums";
import { CategoryService } from "./category.service";

// The service talks to Prisma and the Cloudinary deletion helper only. Both are
// mocked here so no database or provider credentials are required.
const mocks = vi.hoisted(() => ({
    categoryFindFirst: vi.fn(),
    categoryFindUnique: vi.fn(),
    categoryFindMany: vi.fn(),
    categoryCreate: vi.fn(),
    categoryUpdate: vi.fn(),
    categoryCount: vi.fn(),
    productCount: vi.fn(),
    deleteImageByPublicId: vi.fn(),
}));

vi.mock("../../../lib/prisma", () => ({
    prisma: {
        category: {
            findFirst: mocks.categoryFindFirst,
            findUnique: mocks.categoryFindUnique,
            findMany: mocks.categoryFindMany,
            create: mocks.categoryCreate,
            update: mocks.categoryUpdate,
            count: mocks.categoryCount,
        },
        product: { count: mocks.productCount },
    },
}));

vi.mock("../../upload/cloudinary.service", () => ({
    deleteImageByPublicId: mocks.deleteImageByPublicId,
}));

beforeEach(() => {
    vi.resetAllMocks();
});

describe("CategoryService.createCategory", () => {
    it("creates a top-level category without walking the hierarchy", async () => {
        mocks.categoryCreate.mockResolvedValue({ id: "c1" });

        await CategoryService.createCategory({
            name: "SIM Cards",
            slug: "sim-cards",
        });

        expect(mocks.categoryFindUnique).not.toHaveBeenCalled();
        expect(mocks.categoryCreate).toHaveBeenCalledWith({
            data: expect.objectContaining({
                name: "SIM Cards",
                slug: "sim-cards",
                parentId: null,
                isActive: true,
            }),
        });
    });

    it("accepts an existing, non-deleted parent", async () => {
        mocks.categoryFindUnique.mockResolvedValue({
            id: "parent",
            parentId: null,
            isDeleted: false,
        });
        mocks.categoryCreate.mockResolvedValue({ id: "c1" });

        await CategoryService.createCategory({
            name: "Prepaid",
            slug: "prepaid",
            parentId: "parent",
        });

        expect(mocks.categoryCreate).toHaveBeenCalledWith({
            data: expect.objectContaining({ parentId: "parent" }),
        });
    });

    it("rejects a missing parent", async () => {
        mocks.categoryFindUnique.mockResolvedValue(null);

        await expect(
            CategoryService.createCategory({
                name: "Prepaid",
                slug: "prepaid",
                parentId: "missing",
            }),
        ).rejects.toMatchObject({ statusCode: 404 });

        expect(mocks.categoryCreate).not.toHaveBeenCalled();
    });

    it("rejects a soft-deleted parent", async () => {
        mocks.categoryFindUnique.mockResolvedValue({
            id: "parent",
            parentId: null,
            isDeleted: true,
        });

        await expect(
            CategoryService.createCategory({
                name: "Prepaid",
                slug: "prepaid",
                parentId: "parent",
            }),
        ).rejects.toMatchObject({ statusCode: 404 });

        expect(mocks.categoryCreate).not.toHaveBeenCalled();
    });
});

describe("CategoryService.updateCategory", () => {
    it("refuses a category that is its own parent", async () => {
        mocks.categoryFindFirst.mockResolvedValue({ id: "a", parentId: null });

        await expect(
            CategoryService.updateCategory("a", { parentId: "a" }),
        ).rejects.toMatchObject({ statusCode: 400 });

        expect(mocks.categoryUpdate).not.toHaveBeenCalled();
    });

    it("refuses to nest a category under one of its own descendants", async () => {
        mocks.categoryFindFirst.mockResolvedValue({ id: "a", parentId: null });
        mocks.categoryFindUnique
            // "b" is a child of "a" ...
            .mockResolvedValueOnce({ id: "b", parentId: "a", isDeleted: false })
            // ... and "a" is the category being edited: that would close a cycle.
            .mockResolvedValueOnce({ id: "a", parentId: null, isDeleted: false });

        await expect(
            CategoryService.updateCategory("a", { parentId: "b" }),
        ).rejects.toMatchObject({ statusCode: 400 });

        expect(mocks.categoryUpdate).not.toHaveBeenCalled();
    });

    it("allows a legitimate re-parent", async () => {
        mocks.categoryFindFirst.mockResolvedValue({ id: "leaf", parentId: null });
        mocks.categoryFindUnique.mockResolvedValue({
            id: "branch",
            parentId: null,
            isDeleted: false,
        });
        mocks.categoryUpdate.mockResolvedValue({ id: "leaf", parentId: "branch" });

        await CategoryService.updateCategory("leaf", { parentId: "branch" });

        expect(mocks.categoryUpdate).toHaveBeenCalledWith({
            where: { id: "leaf" },
            data: expect.objectContaining({ parentId: "branch" }),
        });
    });

    it("cleans up a replaced image handle only when nothing else references it", async () => {
        mocks.categoryFindFirst.mockResolvedValue({
            id: "c1",
            image: "https://res.cloudinary.com/demo/image/upload/categories/old.png",
            imagePublicId: "rizqifybd/categories/old",
        });
        mocks.categoryUpdate.mockResolvedValue({
            id: "c1",
            image: "https://res.cloudinary.com/demo/image/upload/categories/new.png",
            imagePublicId: "rizqifybd/categories/new",
        });
        mocks.categoryCount.mockResolvedValue(0);

        await CategoryService.updateCategory("c1", {
            image: "https://res.cloudinary.com/demo/image/upload/categories/new.png",
            imagePublicId: "rizqifybd/categories/new",
        });

        expect(mocks.categoryCount).toHaveBeenCalled();
        expect(mocks.deleteImageByPublicId).toHaveBeenCalledWith(
            "rizqifybd/categories/old",
        );
    });

    it("keeps a replaced handle that is still referenced elsewhere", async () => {
        mocks.categoryFindFirst.mockResolvedValue({
            id: "c1",
            image: "https://res.cloudinary.com/demo/image/upload/categories/old.png",
            imagePublicId: "rizqifybd/categories/old",
        });
        mocks.categoryUpdate.mockResolvedValue({
            id: "c1",
            image: "https://res.cloudinary.com/demo/image/upload/categories/new.png",
            imagePublicId: "rizqifybd/categories/new",
        });
        mocks.categoryCount.mockResolvedValue(1);

        await CategoryService.updateCategory("c1", {
            image: "https://res.cloudinary.com/demo/image/upload/categories/new.png",
            imagePublicId: "rizqifybd/categories/new",
        });

        expect(mocks.deleteImageByPublicId).not.toHaveBeenCalled();
    });

    it("never touches the media provider when the image was not part of the patch", async () => {
        mocks.categoryFindFirst.mockResolvedValue({
            id: "c1",
            image: "https://res.cloudinary.com/demo/image/upload/categories/old.png",
            imagePublicId: "rizqifybd/categories/old",
        });
        mocks.categoryUpdate.mockResolvedValue({ id: "c1" });

        await CategoryService.updateCategory("c1", { name: "Renamed" });

        expect(mocks.deleteImageByPublicId).not.toHaveBeenCalled();
    });
});

describe("CategoryService.getCategoryById visibility", () => {
    it("reports an inactive category as missing to a public caller", async () => {
        mocks.categoryFindFirst.mockResolvedValue({ id: "c1", isActive: false });

        await expect(
            CategoryService.getCategoryById("c1", undefined),
        ).rejects.toMatchObject({ statusCode: 404 });
    });

    it("reports an inactive category as missing to a signed-in customer", async () => {
        mocks.categoryFindFirst.mockResolvedValue({ id: "c1", isActive: false });

        await expect(
            CategoryService.getCategoryById("c1", Role.USER),
        ).rejects.toMatchObject({ statusCode: 404 });
    });

    it("returns an inactive category to a content admin", async () => {
        mocks.categoryFindFirst.mockResolvedValue({ id: "c1", isActive: false });

        await expect(
            CategoryService.getCategoryById("c1", Role.ADMIN),
        ).resolves.toMatchObject({ id: "c1" });
    });

    it("never returns a soft-deleted category", async () => {
        mocks.categoryFindFirst.mockResolvedValue(null);

        await expect(
            CategoryService.getCategoryById("c1", Role.SUPER_ADMIN),
        ).rejects.toMatchObject({ statusCode: 404 });

        expect(mocks.categoryFindFirst).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: "c1", isDeleted: false } }),
        );
    });
});

describe("CategoryService.deleteCategory", () => {
    it("refuses to delete a category that still has children", async () => {
        mocks.categoryFindFirst.mockResolvedValue({ id: "c1" });
        mocks.categoryCount.mockResolvedValue(2);
        mocks.productCount.mockResolvedValue(0);

        await expect(
            CategoryService.deleteCategory("c1"),
        ).rejects.toMatchObject({ statusCode: 400 });

        expect(mocks.categoryUpdate).not.toHaveBeenCalled();
    });

    it("refuses to delete a category that still has products", async () => {
        mocks.categoryFindFirst.mockResolvedValue({ id: "c1" });
        mocks.categoryCount.mockResolvedValue(0);
        mocks.productCount.mockResolvedValue(3);

        await expect(
            CategoryService.deleteCategory("c1"),
        ).rejects.toMatchObject({ statusCode: 400 });

        expect(mocks.categoryUpdate).not.toHaveBeenCalled();
    });

    it("soft deletes an unused category", async () => {
        mocks.categoryFindFirst.mockResolvedValue({ id: "c1" });
        mocks.categoryCount.mockResolvedValue(0);
        mocks.productCount.mockResolvedValue(0);
        mocks.categoryUpdate.mockResolvedValue({ id: "c1", isDeleted: true });

        await CategoryService.deleteCategory("c1");

        expect(mocks.categoryUpdate).toHaveBeenCalledWith({
            where: { id: "c1" },
            data: expect.objectContaining({
                isDeleted: true,
                isActive: false,
            }),
        });
    });
});

describe("CategoryService.getAllCategories visibility", () => {
    const findManyWhere = (): Record<string, unknown> =>
        (mocks.categoryFindMany.mock.calls[0]?.[0] as { where: unknown })
            .where as Record<string, unknown>;

    const countWhere = (): Record<string, unknown> =>
        (mocks.categoryCount.mock.calls[0]?.[0] as { where: unknown })
            .where as Record<string, unknown>;

    beforeEach(() => {
        mocks.categoryFindMany.mockResolvedValue([]);
        mocks.categoryCount.mockResolvedValue(0);
    });

    it("forces the published constraints onto a public list query", async () => {
        // The query string asks for soft-deleted, inactive rows; the service must
        // ignore that and keep the public projection intact.
        await CategoryService.getAllCategories(
            { page: "1", limit: "10", isActive: "false", isDeleted: "true" },
            undefined,
        );

        expect(findManyWhere()).toMatchObject({
            isDeleted: false,
            isActive: true,
        });
        // The count runs against the same predicate, so the pagination total can
        // never disagree with the page.
        expect(countWhere()).toMatchObject({
            isDeleted: false,
            isActive: true,
        });
    });

    it("does not let a signed-in customer widen the catalogue either", async () => {
        await CategoryService.getAllCategories(
            { isDeleted: "true" },
            Role.USER,
        );

        expect(findManyWhere()).toMatchObject({ isDeleted: false });
    });

    it("lets a content admin filter on the status flags", async () => {
        await CategoryService.getAllCategories(
            { isActive: "false" },
            Role.ADMIN,
        );

        expect(findManyWhere()).toMatchObject({ isActive: false });
    });
});
