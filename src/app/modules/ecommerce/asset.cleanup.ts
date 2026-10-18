import { deleteImageByPublicId } from "../upload/cloudinary.service";

export interface RemovedImageAsset {
    url: string | null;
    publicId: string | null;
}

// Best-effort removal of the media assets a catalog edit left behind.
//
// Contract (mirrors OperatorService.cleanupReplacedLogoAsset):
//  - only handles that were read back from our own database rows are ever
//    deleted, never a value supplied by the request;
//  - it is called only after the database transaction committed, so a failed
//    write can never reach the deletion call;
//  - an asset that cannot be proven unreferenced is kept.
export const cleanupRemovedImageAssets = async (
    removed: RemovedImageAsset[],
    countReferences: (
        asset: { url: string; publicId: string },
    ) => Promise<number | null>,
): Promise<void> => {
    for (const asset of removed) {
        if (!asset.publicId) continue;

        const references = await countReferences({
            url: asset.url ?? "",
            publicId: asset.publicId,
        }).catch(() => null);

        if (references === null || references > 0) continue;

        try {
            await deleteImageByPublicId(asset.publicId);
        } catch {
            // The catalog change is already durable; a provider failure must not
            // be reverted and must not leak provider internals to the caller.
            console.warn("[catalog-media] removed image asset cleanup skipped");
        }
    }
};

// An asset is considered removed only when neither its handle nor its URL is
// still part of the row being saved.
export const pickRemovedAssets = (
    previous: RemovedImageAsset[],
    nextPublicIds: string[],
    nextUrls: string[],
): RemovedImageAsset[] =>
    previous.filter(
        (asset) =>
            (asset.publicId === null ||
                !nextPublicIds.includes(asset.publicId)) &&
            (asset.url === null || !nextUrls.includes(asset.url)),
    );
