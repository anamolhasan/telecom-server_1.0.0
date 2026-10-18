import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "../../../../generated/prisma/enums";
import { BrandService } from "./brand.service";

// The service talks to Prisma and the Cloudinary deletion helper only. Both are
// mocked here so no database or provider credentials are required.
const mocks = vi.hoisted(() => ({
    brandFindFirst: vi.fn(),
    brandFindMany: vi.fn(),
    brandCreate: vi.fn(),
    brandUpdate: vi.fn(),
    brandCount: vi.fn(),
    deleteImageByPublicId: vi.fn(),
}));

vi.mock("../../../lib/prisma", () => ({
    prisma: {
        brand: {
            findFirst: mocks.brandFindFirst,
            findMany: mocks.brandFindMany,
            create: mocks.brandCreate,
            update: mocks.brandUpdate,
            count: mocks.brandCount,
        },
    },
}));

vi.mock("../../upload/cloudinary.service", () => ({
    deleteImageByPublicId: mocks.deleteImageByPublicId,
}));

beforeEach(() => {
    vi.resetAllMocks();
});

describe("BrandService.createBrand", () => {
    it("activates a brand by default and nulls the optional fields", async () => {
        mocks.brandCreate.mockResolvedValue({ id: "b1" });

        await BrandService.createBrand({ name: "Samsung", slug: "samsung" });

        expect(mocks.brandCreate).toHaveBeenCalledWith({
            data: {
                name: "Samsung",
                slug: "samsung",
                description: null,
                logo: null,
                logoPublicId: null,
                isActive: true,
            },
        });
    });

    it("honours an explicit inactive flag and the logo pair", async () => {
        mocks.brandCreate.mockResolvedValue({ id: "b1" });

        await BrandService.createBrand({
            name: "Samsung",
            slug: "samsung",
            isActive: false,
            logo: "https://res.cloudinary.com/demo/image/upload/brands/samsung.png",
            logoPublicId: "rizqifybd/brands/samsung",
        });

        expect(mocks.brandCreate).toHaveBeenCalledWith({
            data: expect.objectContaining({
                isActive: false,
                logoPublicId: "rizqifybd/brands/samsung",
            }),
        });
    });
});

describe("BrandService.getBrandById visibility", () => {
    it("reports an inactive brand as missing to a public caller", async () => {
        mocks.brandFindFirst.mockResolvedValue({ id: "b1", isActive: false });

        await expect(
            BrandService.getBrandById("b1", undefined),
        ).rejects.toMatchObject({ statusCode: 404 });
    });

    it("returns an inactive brand to a content admin", async () => {
        mocks.brandFindFirst.mockResolvedValue({ id: "b1", isActive: false });

        await expect(
            BrandService.getBrandById("b1", Role.ADMIN),
        ).resolves.toMatchObject({ id: "b1" });
    });

    it("never returns a soft-deleted brand", async () => {
        mocks.brandFindFirst.mockResolvedValue(null);

        await expect(
            BrandService.getBrandById("b1", Role.SUPER_ADMIN),
        ).rejects.toMatchObject({ statusCode: 404 });

        expect(mocks.brandFindFirst).toHaveBeenCalledWith({
            where: { id: "b1", isDeleted: false },
        });
    });
});

describe("BrandService.getAllBrands visibility", () => {
    const findManyWhere = (): Record<string, unknown> =>
        (mocks.brandFindMany.mock.calls[0]?.[0] as { where: unknown })
            .where as Record<string, unknown>;

    beforeEach(() => {
        mocks.brandFindMany.mockResolvedValue([]);
        mocks.brandCount.mockResolvedValue(0);
    });

    it("forces the published constraints onto a public list query", async () => {
        await BrandService.getAllBrands(
            { isActive: "false", isDeleted: "true" },
            undefined,
        );

        expect(findManyWhere()).toMatchObject({
            isDeleted: false,
            isActive: true,
        });
    });

    it("lets a content admin filter on the status flags", async () => {
        await BrandService.getAllBrands({ isActive: "false" }, Role.ADMIN);

        expect(findManyWhere()).toMatchObject({ isActive: false });
    });
});

describe("BrandService.updateBrand", () => {
    it("rejects an unknown brand", async () => {
        mocks.brandFindFirst.mockResolvedValue(null);

        await expect(
            BrandService.updateBrand("b1", { name: "Renamed" }),
        ).rejects.toMatchObject({ statusCode: 404 });

        expect(mocks.brandUpdate).not.toHaveBeenCalled();
    });

    it("cleans up a replaced logo handle only when nothing else references it", async () => {
        mocks.brandFindFirst.mockResolvedValue({
            id: "b1",
            logo: "https://res.cloudinary.com/demo/image/upload/brands/old.png",
            logoPublicId: "rizqifybd/brands/old",
        });
        mocks.brandUpdate.mockResolvedValue({
            id: "b1",
            logo: "https://res.cloudinary.com/demo/image/upload/brands/new.png",
            logoPublicId: "rizqifybd/brands/new",
        });
        mocks.brandCount.mockResolvedValue(0);

        await BrandService.updateBrand("b1", {
            logo: "https://res.cloudinary.com/demo/image/upload/brands/new.png",
            logoPublicId: "rizqifybd/brands/new",
        });

        expect(mocks.deleteImageByPublicId).toHaveBeenCalledWith(
            "rizqifybd/brands/old",
        );
    });

    it("keeps a replaced handle that is still referenced elsewhere", async () => {
        mocks.brandFindFirst.mockResolvedValue({
            id: "b1",
            logo: "https://res.cloudinary.com/demo/image/upload/brands/old.png",
            logoPublicId: "rizqifybd/brands/old",
        });
        mocks.brandUpdate.mockResolvedValue({
            id: "b1",
            logo: "https://res.cloudinary.com/demo/image/upload/brands/new.png",
            logoPublicId: "rizqifybd/brands/new",
        });
        mocks.brandCount.mockResolvedValue(1);

        await BrandService.updateBrand("b1", {
            logo: "https://res.cloudinary.com/demo/image/upload/brands/new.png",
            logoPublicId: "rizqifybd/brands/new",
        });

        expect(mocks.deleteImageByPublicId).not.toHaveBeenCalled();
    });

    it("never touches the media provider when the logo was not part of the patch", async () => {
        mocks.brandFindFirst.mockResolvedValue({
            id: "b1",
            logo: "https://res.cloudinary.com/demo/image/upload/brands/old.png",
            logoPublicId: "rizqifybd/brands/old",
        });
        mocks.brandUpdate.mockResolvedValue({ id: "b1" });

        await BrandService.updateBrand("b1", { name: "Renamed" });

        expect(mocks.deleteImageByPublicId).not.toHaveBeenCalled();
    });
});

describe("BrandService.deleteBrand", () => {
    it("soft deletes and deactivates the brand", async () => {
        mocks.brandFindFirst.mockResolvedValue({ id: "b1" });
        mocks.brandUpdate.mockResolvedValue({ id: "b1", isDeleted: true });

        await BrandService.deleteBrand("b1");

        expect(mocks.brandUpdate).toHaveBeenCalledWith({
            where: { id: "b1" },
            data: expect.objectContaining({
                isDeleted: true,
                isActive: false,
            }),
        });
    });

    it("rejects an unknown brand", async () => {
        mocks.brandFindFirst.mockResolvedValue(null);

        await expect(BrandService.deleteBrand("b1")).rejects.toMatchObject({
            statusCode: 404,
        });

        expect(mocks.brandUpdate).not.toHaveBeenCalled();
    });
});
