import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import exifr from "exifr";
import heicConvert from "heic-convert";
import sharp from "sharp";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const deployedDir = path.resolve(scriptDir, "..");
const assetsDir = path.join(deployedDir, "Assets Needed");
const sourcePhotoRoot = path.join(assetsDir, "Photos of Clusters and Sub-villages");
const dataDir = path.join(deployedDir, "cursor_v2_map_data");
const previewDir = path.join(dataDir, "photo_previews");

const photoExtensions = new Set([".jpg", ".jpeg", ".heic"]);
const maxPreviewWidth = 1200;
const maxPreviewHeight = 900;

const explicitNeedPattern =
  /\b(needed|required|damaged|damage|non[- ]?functional|insufficient|rehabilitat|lack of|flood[- ]?prone|flood prone|protection wall|earthquake)\b/i;

const neutralAssetPattern =
  /\b(shop|market|mosque|tailor|tailoring|mechanic|workshop|farm|oil pump|telecome|telecom|wifi|bread oven|car wash|start point|end point|starting point|ending point|border with)\b/i;

const themeRules = [
  {
    theme: "Flood / DRR",
    markerClass: "flood",
    pattern: /\b(flood|floodway|flood way|flood[- ]?prone|protection wall|watergate|river edge)\b/i
  },
  {
    theme: "WASH",
    markerClass: "wash",
    pattern: /\b(wash|water well|hand pump|water storage|water supply|water network|water intake|drinking water|bathroom|latrine|karez)\b/i
  },
  {
    theme: "Education",
    markerClass: "education",
    pattern: /\b(school|class room|classroom|cbe|madrassa|madrasa|education)\b/i
  },
  {
    theme: "Irrigation",
    markerClass: "irrigation",
    pattern: /\b(irrigation|canal|check dam|watergate)\b/i
  },
  {
    theme: "Road access",
    markerClass: "road",
    pattern: /\b(road|bridge|culvert|access)\b/i
  },
  {
    theme: "Health",
    markerClass: "health",
    pattern: /\b(health|clinic|mobile clinic|bhc|chc|pharmacy)\b/i
  },
  {
    theme: "Shelter",
    markerClass: "shelter",
    pattern: /\b(shelter|tent|returnee|under construction house|house)\b/i
  }
];

function asPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function titleFromFileName(fileName) {
  return path.basename(fileName, path.extname(fileName)).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeCluster(value) {
  const match = String(value || "").match(/cluster\s*#?\s*(\d+)/i);
  if (match) return `Cluster ${Number(match[1])}`;
  if (/nawabad|naw abad/i.test(String(value || ""))) return "Nawabad Cluster";
  return String(value || "").trim();
}

function normalizeVillage(value) {
  return String(value || "")
    .replace(/\s+villlage\b/i, " Village")
    .replace(/\s+villiage\b/i, " Village")
    .replace(/\s+/g, " ")
    .trim();
}

function inferNawabadVillage(fileName) {
  const lower = fileName.toLowerCase();
  const spellings = [
    ["bala", "Nawabad Bala"],
    ["paeen", "Nawabad Paeen"],
    ["payen", "Nawabad Paeen"],
    ["markazi", "Nawabad Markazi"],
    ["kunjak", "Nawabad Kunjak"],
    ["konjak", "Nawabad Kunjak"],
    ["kojank", "Nawabad Kunjak"],
    ["kamar", "Palaw Kamar"]
  ];

  for (const [needle, village] of spellings) {
    if (lower.includes(needle)) return village;
  }

  return "Nawabad";
}

function inferClusterVillage(absolutePath) {
  const relativeParts = path.relative(sourcePhotoRoot, absolutePath).split(path.sep);
  const clusterIndex = relativeParts.findIndex((part) => /^cluster\s*#?\s*\d+/i.test(part));
  if (clusterIndex >= 0) {
    return {
      province: relativeParts[0] || "",
      cluster: normalizeCluster(relativeParts[clusterIndex]),
      village: normalizeVillage(relativeParts[clusterIndex + 1] || "")
    };
  }

  if (relativeParts.some((part) => /nawabad|naw abad/i.test(part))) {
    return {
      province: relativeParts[0] || "",
      cluster: "Nawabad Cluster",
      village: inferNawabadVillage(path.basename(absolutePath))
    };
  }

  return {
    province: relativeParts[0] || "",
    cluster: "",
    village: ""
  };
}

function classifyTheme(fileName) {
  for (const rule of themeRules) {
    if (rule.pattern.test(fileName)) return rule;
  }
  return { theme: "Other", markerClass: "other" };
}

function isPriorityCandidate(photo) {
  const explicitNeed = explicitNeedPattern.test(photo.fileName);
  if (explicitNeed) return true;
  if (photo.theme === "Other") return false;
  if (neutralAssetPattern.test(photo.fileName)) return false;
  return true;
}

function priorityLevel(photo) {
  if (explicitNeedPattern.test(photo.fileName)) return "High";
  if (["Flood / DRR", "WASH", "Education", "Health"].includes(photo.theme)) return "High";
  return "Medium";
}

function priorityNote(photo) {
  const title = titleFromFileName(photo.fileName);
  if (explicitNeedPattern.test(photo.fileName)) {
    return `Photo-backed need identified from the field photo "${photo.fileName}". Validate final wording against the cluster FGD needs prioritization report.`;
  }
  return `${photo.theme} priority evidence identified from field photo "${photo.fileName}". Validate final priority text against the cluster FGD needs prioritization report.`;
}

function sourceDocument(photo) {
  if (photo.cluster === "Nawabad Cluster") return "Community Priorities_Nawabad Cluster.docx";
  const number = photo.cluster.match(/\d+/)?.[0];
  return number ? `Needs Prioritization under FGD - ${photo.cluster}` : "Needs Prioritization under FGD";
}

async function walkFiles(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(absolutePath));
    } else if (photoExtensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(absolutePath);
    }
  }

  return files;
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
      image: `cursor_v2_map_data/photo_previews/${fileName}`,
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

    await sharp(source, { limitInputPixels: false })
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
      image: `cursor_v2_map_data/photo_previews/${fileName}`,
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

function distanceMeters(left, right) {
  const dLat = (left.lat - right.lat) * 111000;
  const dLon = (left.lon - right.lon) * 85000;
  return Math.hypot(dLat, dLon);
}

function groupPriorityPhotos(photos) {
  const groups = [];
  const maxGroupDistanceMeters = 25;

  for (const photo of photos) {
    const group = groups.find((candidate) => {
      const first = candidate.photos[0];
      return first.cluster === photo.cluster
        && first.village === photo.village
        && first.theme === photo.theme
        && distanceMeters(first, photo) <= maxGroupDistanceMeters;
    });

    if (group) {
      group.photos.push(photo);
      continue;
    }

    groups.push({ photos: [photo] });
  }

  return groups.map((group, index) => {
    const photos = group.photos.sort((left, right) => left.fileName.localeCompare(right.fileName));
    const first = photos[0];
    const averageLat = photos.reduce((total, photo) => total + photo.lat, 0) / photos.length;
    const averageLon = photos.reduce((total, photo) => total + photo.lon, 0) / photos.length;
    const title = photos.length > 1
      ? `${first.theme} priority evidence (${photos.length} photos)`
      : titleFromFileName(first.fileName);

    const mappedPhotos = photos.map((photo) => ({
      title: titleFromFileName(photo.fileName),
      image: photo.image,
      file: photo.fileName,
      theme: photo.theme,
      level: priorityLevel(photo),
      note: priorityNote(photo),
      lat: photo.lat,
      lon: photo.lon
    }));

    return {
      id: index + 1,
      title,
      cluster: first.cluster,
      village: first.village,
      theme: first.theme,
      level: priorityLevel(first),
      markerClass: first.markerClass,
      note: priorityNote(first),
      sourceDocument: sourceDocument(first),
      lat: Number(averageLat.toFixed(8)),
      lon: Number(averageLon.toFixed(8)),
      image: mappedPhotos[0].image,
      file: mappedPhotos[0].file,
      photoCount: mappedPhotos.length,
      photos: mappedPhotos
    };
  });
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

async function writePhotoIndex(photos) {
  const helper = `
window.findPhotoAt = function findPhotoAt(lat, lon, maxDistanceMeters) {
  const photos = window.CURSOR_V2_PHOTO_INDEX || [];
  const maxDistance = maxDistanceMeters == null ? 75 : maxDistanceMeters;
  let best = null;
  let bestDistance = maxDistance;

  for (const photo of photos) {
    const dLat = (photo.lat - lat) * 111000;
    const dLon = (photo.lon - lon) * 85000;
    const distance = Math.hypot(dLat, dLon);
    if (distance <= bestDistance) {
      best = photo;
      bestDistance = distance;
    }
  }

  return best;
};

window.photoPopupHtml = function photoPopupHtml(photo, title, metaRows) {
  if (!photo) {
    return title + (metaRows || "");
  }

  const imageSrc = encodeURI(photo.image).replace(/#/g, "%23");
  const safeTitle = String(title || photo.fileName || "Field photo")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
  const meta = metaRows || "";
  return \`
    <img class="popup-photo" src="\${imageSrc}" alt="\${safeTitle}" data-display-src="\${imageSrc}">
    <h3 class="popup-title">\${title}</h3>
    <div class="popup-meta">
      <span><strong>Photo:</strong> \${photo.fileName}</span>
      \${photo.village ? \`<span><strong>Village:</strong> \${photo.village}</span>\` : ""}
      \${photo.cluster ? \`<span><strong>Cluster:</strong> \${photo.cluster}</span>\` : ""}
      <span><strong>GPS:</strong> \${photo.lat.toFixed(8)}, \${photo.lon.toFixed(8)}</span>
      \${meta}
    </div>
  \`;
};
`;

  const content = [
    "// Generated from Assets Needed/Photos of Clusters and Sub-villages.",
    formatJsAssignment("CURSOR_V2_PHOTO_INDEX", photos),
    helper.trimStart()
  ].join("\n");

  await fs.writeFile(path.join(dataDir, "photo_index.js"), content, "utf8");
}

async function writePriorities(priorityPoints) {
  const filters = buildFilters(priorityPoints);
  const content = [
    "// Generated from Assets Needed source photos and filename-based priority heuristics.",
    "// Review the notes/sourceDocument fields against the FGD needs prioritization reports before final publication.",
    formatJsAssignment("PHOTO_BACKED_PRIORITIES", priorityPoints),
    formatJsAssignment("PHOTO_BACKED_FILTERS", filters)
  ].join("\n");

  await fs.writeFile(path.join(dataDir, "photo_backed_priorities.js"), content, "utf8");
}

async function main() {
  await fs.mkdir(previewDir, { recursive: true });

  const sourceFiles = await walkFiles(sourcePhotoRoot);
  const photos = [];
  const failures = [];
  let generatedPreviews = 0;

  for (const absolutePath of sourceFiles) {
    const fileName = path.basename(absolutePath);
    const { province, cluster, village } = inferClusterVillage(absolutePath);
    if (!cluster) continue;

    let gps;
    try {
      gps = await exifr.gps(absolutePath);
    } catch (error) {
      failures.push({ fileName, reason: `GPS read failed: ${error.message}` });
      continue;
    }

    if (!gps?.latitude || !gps?.longitude) {
      failures.push({ fileName, reason: "No GPS metadata" });
      continue;
    }

    const hash = await hashFile(absolutePath);
    const preview = await ensurePreview(absolutePath, hash);
    if (preview.previewGenerated) generatedPreviews += 1;
    if (preview.previewError) {
      failures.push({ fileName, reason: `Preview failed: ${preview.previewError}` });
    }

    const { theme, markerClass } = classifyTheme(fileName);
    const relativePath = asPosix(path.relative(deployedDir, absolutePath));

    photos.push({
      id: photos.length + 1,
      fileName,
      title: titleFromFileName(fileName),
      image: preview.image,
      sourcePath: relativePath,
      province,
      cluster,
      village,
      theme,
      markerClass,
      lat: Number(gps.latitude.toFixed(8)),
      lon: Number(gps.longitude.toFixed(8))
    });
  }

  photos.sort((left, right) => {
    const clusterCompare = left.cluster.localeCompare(right.cluster, undefined, { numeric: true });
    if (clusterCompare) return clusterCompare;
    const villageCompare = left.village.localeCompare(right.village);
    if (villageCompare) return villageCompare;
    return left.fileName.localeCompare(right.fileName);
  });

  photos.forEach((photo, index) => {
    photo.id = index + 1;
  });

  const priorityPhotos = photos.filter(isPriorityCandidate);
  const priorityPoints = groupPriorityPhotos(priorityPhotos).sort((left, right) => {
    const clusterCompare = left.cluster.localeCompare(right.cluster, undefined, { numeric: true });
    if (clusterCompare) return clusterCompare;
    const villageCompare = left.village.localeCompare(right.village);
    if (villageCompare) return villageCompare;
    return left.title.localeCompare(right.title);
  }).map((point, index) => ({ ...point, id: index + 1 }));

  await writePhotoIndex(photos);
  await writePriorities(priorityPoints);

  const summary = {
    sourceFiles: sourceFiles.length,
    geotaggedPhotos: photos.length,
    priorityPhotos: priorityPhotos.length,
    priorityPoints: priorityPoints.length,
    generatedPreviews,
    failures: failures.length,
    sampleFailures: failures.slice(0, 10)
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
