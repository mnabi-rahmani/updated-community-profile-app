import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadWindowAssignments } from "./photo-asset-utils.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const deployedDir = path.resolve(scriptDir, "..");
const dataDir = path.join(deployedDir, "cursor_v2_map_data");
const radiusMeters = 100;

function haversineMeters(lat1, lon1, lat2, lon2) {
  const radius = 6371000;
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const dPhi = (lat2 - lat1) * Math.PI / 180;
  const dLambda = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dPhi / 2) ** 2
    + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function burstGroupKey(fileName) {
  let base = path.basename(String(fileName || ""), path.extname(String(fileName || "")));
  base = base.replace(/\s*\(\d+\)\s*$/i, "");
  base = base.replace(/(\D)\d+$/i, "$1");
  return base.toLowerCase().replace(/\s+/g, " ").trim();
}

async function main() {
  const windowData = loadWindowAssignments(dataDir, "infrastructure_priorities.js");
  const priorities = windowData.INFRASTRUCTURE_PRIORITIES || [];
  const issues = [];
  const summary = [];

  for (const point of priorities) {
    const photos = point.photos || [];
    const imageSet = new Set();
    const burstSet = new Set();
    let maxDistance = 0;

    for (const photo of photos) {
      const distance = haversineMeters(point.lat, point.lon, photo.lat, photo.lon);
      maxDistance = Math.max(maxDistance, distance);

      if (distance > radiusMeters + 0.001) {
        issues.push({
          type: "distance",
          priorityId: point.id,
          intervention: point.intervention,
          file: photo.file,
          distanceMeters: Number(distance.toFixed(2))
        });
      }

      if (imageSet.has(photo.image)) {
        issues.push({
          type: "duplicate-image",
          priorityId: point.id,
          intervention: point.intervention,
          file: photo.file,
          image: photo.image
        });
      }
      imageSet.add(photo.image);

      const burstKey = burstGroupKey(photo.file);
      if (burstSet.has(burstKey)) {
        issues.push({
          type: "duplicate-burst",
          priorityId: point.id,
          intervention: point.intervention,
          file: photo.file,
          burstKey
        });
      }
      burstSet.add(burstKey);
    }

    if (point.photoCount !== photos.length) {
      issues.push({
        type: "photo-count-mismatch",
        priorityId: point.id,
        intervention: point.intervention,
        photoCount: point.photoCount,
        actual: photos.length
      });
    }

    summary.push({
      id: point.id,
      cluster: point.cluster,
      intervention: point.intervention,
      photoCount: photos.length,
      maxDistanceMeters: Number(maxDistance.toFixed(2))
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    radiusMeters,
    priorities: priorities.length,
    prioritiesWithPhotos: summary.filter((entry) => entry.photoCount > 0).length,
    totalAssignedPhotos: summary.reduce((total, entry) => total + entry.photoCount, 0),
    issues,
    topPhotoCounts: [...summary].sort((left, right) => right.photoCount - left.photoCount).slice(0, 15)
  };

  const reportPath = path.join(dataDir, "infrastructure_priority_photos_audit.json");
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(JSON.stringify(report, null, 2));
  console.log(`\nWrote ${reportPath}`);

  if (issues.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
