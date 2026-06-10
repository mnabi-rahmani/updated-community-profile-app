import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import exifr from "exifr";
import heicConvert from "heic-convert";
import sharp from "sharp";
import XLSX from "xlsx";

import {
  collectPreviewHashesFromRecords,
  deduplicateRecordsByHash,
  removeOrphanPreviewFiles
} from "./photo-asset-utils.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const deployedDir = path.resolve(scriptDir, "..");
const allAssetsRoot = path.join(deployedDir, "Assets Needed");
const infrastructureAssetsRoot = path.join(
  allAssetsRoot,
  "Infrastructure list for priority mapping"
);
const dataDir = path.join(deployedDir, "cursor_v2_map_data");
const previewDir = path.join(dataDir, "infrastructure_photo_previews");

const excelFiles = [
  {
    fileName: "Baghlan Infrastructure Priorities.xlsx",
    region: "Baghlan-e-Jadid"
  },
  {
    fileName: "Nawabad Infrastructure Priorities.xlsx",
    region: "Nawabad",
    defaultCluster: "Nawabad Cluster"
  }
];

const photoExtensions = new Set([".jpg", ".jpeg", ".heic", ".png"]);
const maxPreviewWidth = 1200;
const maxPreviewHeight = 900;
const areaPhotoRadiusMeters = 100;

function asPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function compactWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function parseCoordinate(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = compactWhitespace(value);
  if (!text) return null;
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeClusterFromSheet(sheetName, fallback) {
  const match = String(sheetName || "").match(/cluster\s*#?\s*(\d+)/i);
  if (match) return `Cluster ${Number(match[1])}`;
  if (/nawabad/i.test(String(sheetName || ""))) return "Nawabad Cluster";
  return fallback || "";
}

function normalizePriorityLevel(value) {
  const text = compactWhitespace(value);
  if (!text) return "Medium";
  if (/high/i.test(text)) return "High";
  if (/medium|meduim/i.test(text)) return "Medium";
  if (/low/i.test(text)) return "Low";
  return text;
}

function buildAreaPhotoRecords(photos) {
  return photos
    .filter((photo) => photo.lat != null && photo.lon != null && photo.image)
    .map((photo) => ({
      image: photo.image,
      file: photo.fileName,
      lat: Number(photo.lat.toFixed(8)),
      lon: Number(photo.lon.toFixed(8))
    }));
}

async function hashFile(absolutePath) {
  const content = await fs.readFile(absolutePath);
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

async function ensurePreview(absolutePath, hash) {
  const fileName = `${hash}.jpg`;
  const outputPath = path.join(previewDir, fileName);

  try {
    await fs.access(outputPath);
    return {
      image: `cursor_v2_map_data/infrastructure_photo_previews/${fileName}`,
      previewGenerated: false
    };
  } catch {
    // Generate below.
  }

  try {
    let source = absolutePath;
    if (path.extname(absolutePath).toLowerCase() === ".heic") {
      const inputBuffer = await fs.readFile(absolutePath);
      source = await heicConvert({
        buffer: inputBuffer,
        format: "JPEG",
        quality: 0.86
      });
    }

    await sharp(source, { limitInputPixels: false, failOn: "none" })
      .rotate()
      .resize({
        width: maxPreviewWidth,
        height: maxPreviewHeight,
        fit: "inside",
        withoutEnlargement: true
      })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(outputPath);

    return {
      image: `cursor_v2_map_data/infrastructure_photo_previews/${fileName}`,
      previewGenerated: true
    };
  } catch (error) {
    const relativeOriginal = asPosix(path.relative(deployedDir, absolutePath));
    return {
      image: relativeOriginal,
      previewGenerated: false,
      previewError: error.message
    };
  }
}

async function walkPhotos(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkPhotos(absolutePath));
    } else if (photoExtensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(absolutePath);
    }
  }

  return files;
}

function inferPhotoCluster(relativePath) {
  const parts = relativePath.split(/[\\/]/);
  for (const part of parts) {
    const cluster = normalizeClusterFromSheet(part, "");
    if (cluster) return cluster;
  }
  if (/nawabad/i.test(relativePath)) return "Nawabad Cluster";
  return "";
}

async function indexPhotoCatalog(root) {
  const absolutePaths = await walkPhotos(root);
  const catalog = [];

  for (const absolutePath of absolutePaths) {
    const relativePath = path.relative(root, absolutePath);
    const fileName = path.basename(absolutePath);
    let lat = null;
    let lon = null;

    try {
      const gps = await exifr.gps(absolutePath);
      if (gps?.latitude != null && gps?.longitude != null) {
        lat = Number(gps.latitude);
        lon = Number(gps.longitude);
      }
    } catch {
      // Photo may not include GPS metadata.
    }

    catalog.push({
      absolutePath,
      relativePath: asPosix(relativePath),
      fileName,
      cluster: inferPhotoCluster(relativePath),
      lat,
      lon
    });
  }

  return catalog;
}

async function attachPhotoPreviews(photos) {
  for (const photo of photos) {
    const hash = await hashFile(photo.absolutePath);
    const preview = await ensurePreview(photo.absolutePath, hash);
    photo.image = preview.image;
    photo.hash = hash;
  }
}

function readPriorityRows() {
  const rows = [];

  for (const excel of excelFiles) {
    const workbookPath = path.join(infrastructureAssetsRoot, excel.fileName);
    const workbook = XLSX.readFile(workbookPath);

    for (const sheetName of workbook.SheetNames) {
      const sheetRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
      const cluster = normalizeClusterFromSheet(sheetName, excel.defaultCluster || "");

      for (const row of sheetRows) {
        const intervention = compactWhitespace(row["Infrastructure Priority interventions"]);
        const location = compactWhitespace(row["Specific location in the community"]);
        if (!intervention) continue;

        rows.push({
          region: excel.region,
          cluster,
          intervention,
          location,
          level: normalizePriorityLevel(row["Priority level"]),
          lat: parseCoordinate(row.Latitude),
          lon: parseCoordinate(row.Longitude),
          sheetName,
          rowNumber: row.NO
        });
      }
    }
  }

  return rows;
}

function buildFilters(priorityPoints) {
  const clusterOrder = new Map();

  for (const point of priorityPoints) {
    if (!clusterOrder.has(point.cluster)) clusterOrder.set(point.cluster, []);
    clusterOrder.get(point.cluster).push(point.village);
  }

  const clusters = [...clusterOrder.keys()].sort((left, right) => {
    if (left === "Nawabad Cluster") return 1;
    if (right === "Nawabad Cluster") return -1;
    return (Number(left.match(/\d+/)?.[0]) || 0) - (Number(right.match(/\d+/)?.[0]) || 0);
  });

  const villagesByCluster = { All: [] };
  for (const cluster of clusters) {
    const villages = [...new Set(clusterOrder.get(cluster).filter(Boolean))].sort();
    villagesByCluster[cluster] = villages;
    villagesByCluster.All.push(...villages);
  }
  villagesByCluster.All = [...new Set(villagesByCluster.All)].sort();

  return { clusters, villagesByCluster };
}

function formatJsAssignment(name, value) {
  return `window.${name} = ${JSON.stringify(value, null, 2)};\n`;
}

function buildPriorityPoints(rows) {
  const points = [];

  rows.forEach((row, index) => {
    if (row.lat == null || row.lon == null) {
      console.warn(`Skipping priority without coordinates: ${row.intervention} (${row.cluster})`);
      return;
    }

    points.push({
      id: index + 1,
      priorityNumber: row.rowNumber ?? index + 1,
      cluster: row.cluster,
      intervention: row.intervention,
      location: row.location,
      level: row.level,
      lat: Number(row.lat.toFixed(8)),
      lon: Number(row.lon.toFixed(8)),
      title: row.intervention,
      village: row.location,
      markerClass: "infrastructure",
      image: "",
      file: "",
      photoCount: 0,
      photos: []
    });
  });

  return points;
}

async function main() {
  await fs.mkdir(previewDir, { recursive: true });

  console.log(`Scanning photos under ${allAssetsRoot}...`);
  const photos = await indexPhotoCatalog(allAssetsRoot);
  const gpsPhotoCount = photos.filter((photo) => photo.lat != null).length;
  console.log(`Indexed ${photos.length} photos (${gpsPhotoCount} with GPS).`);

  console.log("Reading infrastructure priority spreadsheets...");
  const rows = readPriorityRows();
  console.log(`Loaded ${rows.length} infrastructure priority rows.`);

  const gpsPhotos = photos.filter((photo) => photo.lat != null && photo.lon != null);
  console.log(`Generating previews for ${gpsPhotos.length} GPS-tagged photos...`);
  await attachPhotoPreviews(gpsPhotos);

  const { deduped: uniqueGpsPhotos, removed: duplicateCount } = deduplicateRecordsByHash(gpsPhotos, {
    preferredPathMarker: "Infrastructure list for priority mapping"
  });
  if (duplicateCount) {
    console.log(`Removed ${duplicateCount} duplicate photos (${uniqueGpsPhotos.length} unique by content hash).`);
  }

  const areaPhotos = buildAreaPhotoRecords(uniqueGpsPhotos);
  const referencedHashes = collectPreviewHashesFromRecords(areaPhotos);
  const removedOrphans = await removeOrphanPreviewFiles(previewDir, referencedHashes);
  if (removedOrphans) {
    console.log(`Removed ${removedOrphans} unreferenced infrastructure preview file(s).`);
  }
  const priorityPoints = buildPriorityPoints(rows);
  const filters = buildFilters(priorityPoints);

  const reviewReport = priorityPoints.map((point) => ({
    id: point.id,
    priorityNumber: point.priorityNumber,
    cluster: point.cluster,
    intervention: point.intervention,
    location: point.location,
    level: point.level,
    lat: point.lat,
    lon: point.lon
  }));

  const content = [
    "// Generated from Infrastructure list for priority mapping Excel workbooks.",
    formatJsAssignment("INFRASTRUCTURE_PRIORITIES", priorityPoints),
    formatJsAssignment("INFRASTRUCTURE_FILTERS", filters)
  ].join("\n");

  const areaPhotoContent = [
    `// GPS-tagged field photos within ${areaPhotoRadiusMeters} m can be browsed per priority in the map UI.`,
    formatJsAssignment("INFRASTRUCTURE_AREA_PHOTOS", areaPhotos)
  ].join("\n");

  await fs.writeFile(path.join(dataDir, "infrastructure_priorities.js"), content, "utf8");
  await fs.writeFile(path.join(dataDir, "infrastructure_area_photos.js"), areaPhotoContent, "utf8");
  await fs.writeFile(
    path.join(dataDir, "infrastructure_priorities_review.json"),
    `${JSON.stringify(reviewReport, null, 2)}\n`,
    "utf8"
  );

  console.log(`Wrote ${priorityPoints.length} infrastructure priorities and ${areaPhotos.length} area photos.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
