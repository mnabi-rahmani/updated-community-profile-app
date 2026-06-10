import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  collectPreviewHashesFromRecords,
  loadWindowAssignments,
  listPreviewHashes,
  previewHash
} from "./photo-asset-utils.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const deployedDir = path.resolve(scriptDir, "..");
const dataDir = path.join(deployedDir, "cursor_v2_map_data");
const assetsDir = path.join(deployedDir, "Assets Needed");

const photoExtensions = new Set([".jpg", ".jpeg", ".heic", ".png"]);

function asPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

async function pathExists(absolutePath) {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function walkAssetImages(root) {
  const files = [];

  async function walk(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (photoExtensions.has(path.extname(entry.name).toLowerCase())) {
        files.push(absolutePath);
      }
    }
  }

  await walk(root);
  return files;
}

function duplicateImageGroups(records) {
  const groups = new Map();

  for (const record of records) {
    const image = record?.image;
    if (!image) continue;
    if (!groups.has(image)) groups.set(image, []);
    groups.get(image).push(record);
  }

  return [...groups.entries()].filter(([, items]) => items.length > 1);
}

function summarizeBrokenSources(records, sourceField) {
  return records.filter((record) => {
    const sourcePath = record?.[sourceField];
    if (!sourcePath) return false;
    return !sourcePath.includes("photo_previews");
  });
}

async function auditMap({
  name,
  previewDirName,
  dataFiles,
  areaPhotosKey,
  prioritiesKey,
  photoIndexKey
}) {
  const previewDir = path.join(dataDir, previewDirName);
  const windowData = {};

  for (const fileName of dataFiles) {
    Object.assign(windowData, loadWindowAssignments(dataDir, fileName));
  }

  const areaPhotos = areaPhotosKey ? (windowData[areaPhotosKey] || []) : [];
  const priorities = prioritiesKey ? (windowData[prioritiesKey] || []) : [];
  const photoIndex = photoIndexKey ? (windowData[photoIndexKey] || []) : [];

  const referencedHashes = collectPreviewHashesFromRecords([
    ...areaPhotos,
    ...priorities,
    ...photoIndex
  ]);
  const previewHashesOnDisk = await listPreviewHashes(previewDir);

  const orphanPreviewFiles = [...previewHashesOnDisk].filter((hash) => !referencedHashes.has(hash));
  const missingPreviewFiles = [...referencedHashes].filter((hash) => !previewHashesOnDisk.has(hash));

  const duplicateAreaImages = duplicateImageGroups(areaPhotos);
  const duplicateIndexImages = duplicateImageGroups(photoIndex);

  const brokenAreaSources = [];
  for (const record of areaPhotos) {
    if (!record.image?.includes("photo_previews") && !(await pathExists(path.join(deployedDir, record.image)))) {
      brokenAreaSources.push(record);
    }
  }

  const brokenIndexSources = [];
  for (const record of photoIndex) {
    if (record.sourcePath && !(await pathExists(path.join(deployedDir, record.sourcePath)))) {
      brokenIndexSources.push(record);
    }
  }

  const brokenPrioritySources = [];
  for (const point of priorities) {
    for (const photo of point.photos || []) {
      if (photo.image?.includes("photo_previews")) continue;
      if (!(await pathExists(path.join(deployedDir, photo.image)))) {
        brokenPrioritySources.push({ point: point.title, ...photo });
      }
    }
  }

  const nonPreviewRefs = [
    ...areaPhotos.filter((record) => record.image && !record.image.includes("photo_previews")),
    ...photoIndex.filter((record) => record.image && !record.image.includes("photo_previews")),
    ...priorities.flatMap((point) => (point.photos || []).filter((photo) => photo.image && !photo.image.includes("photo_previews")))
  ];

  return {
    name,
    records: {
      areaPhotos: areaPhotos.length,
      priorities: priorities.length,
      photoIndex: photoIndex.length
    },
    previews: {
      onDisk: previewHashesOnDisk.size,
      referenced: referencedHashes.size,
      orphanFiles: orphanPreviewFiles.length,
      missingFiles: missingPreviewFiles.length,
      orphanSample: orphanPreviewFiles.slice(0, 10),
      missingSample: missingPreviewFiles.slice(0, 10)
    },
    duplicates: {
      areaPhotoImagePaths: duplicateAreaImages.length,
      photoIndexImagePaths: duplicateIndexImages.length
    },
    brokenReferences: {
      areaNonPreviewMissingSource: brokenAreaSources.length,
      photoIndexMissingSource: brokenIndexSources.length,
      prioritiesMissingSource: brokenPrioritySources.length,
      nonPreviewRefs: nonPreviewRefs.length,
      samples: {
        area: brokenAreaSources.slice(0, 5).map((record) => ({ file: record.file, image: record.image })),
        photoIndex: brokenIndexSources.slice(0, 5).map((record) => ({ fileName: record.fileName, sourcePath: record.sourcePath })),
        priorities: brokenPrioritySources.slice(0, 5).map((record) => ({ point: record.point, file: record.file, image: record.image })),
        nonPreview: nonPreviewRefs.slice(0, 5).map((record) => ({
          file: record.file || record.fileName,
          image: record.image
        }))
      }
    }
  };
}

async function auditAssets(communityIndex, infraAreaPhotos) {
  const communitySources = new Set(
    communityIndex.map((record) => record.sourcePath).filter(Boolean)
  );
  const infraSources = new Set(
    infraAreaPhotos
      .filter((record) => record.image && !record.image.includes("photo_previews"))
      .map((record) => record.image)
  );

  const assetImages = await walkAssetImages(assetsDir);
  const unindexed = [];
  const missingOnDisk = [];

  for (const absolutePath of assetImages) {
    const relativePath = asPosix(path.relative(deployedDir, absolutePath));
    const indexedInCommunity = communitySources.has(relativePath);
    const indexedInInfra = relativePath.includes("Infrastructure list for priority mapping")
      || infraSources.has(relativePath);

    if (!indexedInCommunity && !indexedInInfra) {
      unindexed.push(relativePath);
    }
  }

  for (const sourcePath of communitySources) {
    if (!(await pathExists(path.join(deployedDir, sourcePath)))) {
      missingOnDisk.push({ map: "community", path: sourcePath });
    }
  }

  for (const sourcePath of infraSources) {
    if (!(await pathExists(path.join(deployedDir, sourcePath)))) {
      missingOnDisk.push({ map: "cluster", path: sourcePath });
    }
  }

  const unindexedByFolder = unindexed.reduce((counts, relativePath) => {
    const topFolder = relativePath.split("/").slice(0, 2).join("/");
    counts[topFolder] = (counts[topFolder] || 0) + 1;
    return counts;
  }, {});

  return {
    totalAssetImages: assetImages.length,
    unindexedAssetImages: unindexed.length,
    unindexedByFolder,
    missingIndexedSourceFiles: missingOnDisk.length,
    missingIndexedSourceSample: missingOnDisk.slice(0, 10)
  };
}

async function main() {
  const communityWindow = loadWindowAssignments(dataDir, "photo_index.js");
  Object.assign(communityWindow, loadWindowAssignments(dataDir, "photo_backed_priorities.js"));
  const infraWindow = loadWindowAssignments(dataDir, "infrastructure_area_photos.js");

  const community = await auditMap({
    name: "Assets and Community Priorities Old",
    previewDirName: "photo_previews",
    dataFiles: ["photo_index.js", "photo_backed_priorities.js"],
    areaPhotosKey: null,
    prioritiesKey: "PHOTO_BACKED_PRIORITIES",
    photoIndexKey: "CURSOR_V2_PHOTO_INDEX"
  });

  const cluster = await auditMap({
    name: "Cluster Priorities Only",
    previewDirName: "infrastructure_photo_previews",
    dataFiles: ["infrastructure_area_photos.js", "infrastructure_priorities.js"],
    areaPhotosKey: "INFRASTRUCTURE_AREA_PHOTOS",
    prioritiesKey: "INFRASTRUCTURE_PRIORITIES",
    photoIndexKey: null
  });

  const communityHashes = collectPreviewHashesFromRecords([
    ...(communityWindow.CURSOR_V2_PHOTO_INDEX || []),
    ...(communityWindow.PHOTO_BACKED_PRIORITIES || [])
  ]);
  const clusterHashes = collectPreviewHashesFromRecords(infraWindow.INFRASTRUCTURE_AREA_PHOTOS || []);
  const sharedPreviewHashes = [...communityHashes].filter((hash) => clusterHashes.has(hash));

  const assets = await auditAssets(
    communityWindow.CURSOR_V2_PHOTO_INDEX || [],
    infraWindow.INFRASTRUCTURE_AREA_PHOTOS || []
  );

  const report = {
    generatedAt: new Date().toISOString(),
    community,
    cluster,
    crossMap: {
      sharedPreviewHashes: sharedPreviewHashes.length
    },
    assets
  };

  const reportPath = path.join(dataDir, "photo_orphan_audit.json");
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const issueCount =
    community.previews.orphanFiles
    + community.previews.missingFiles
    + community.duplicates.areaPhotoImagePaths
    + community.duplicates.photoIndexImagePaths
    + community.brokenReferences.areaNonPreviewMissingSource
    + community.brokenReferences.photoIndexMissingSource
    + community.brokenReferences.prioritiesMissingSource
    + cluster.previews.orphanFiles
    + cluster.previews.missingFiles
    + cluster.duplicates.areaPhotoImagePaths
    + cluster.brokenReferences.areaNonPreviewMissingSource
    + assets.missingIndexedSourceFiles;

  console.log(JSON.stringify(report, null, 2));
  console.log(`\nWrote ${reportPath}`);
  console.log(`Total orphan/broken/duplicate issues found: ${issueCount}`);

  if (issueCount > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
