import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

export function previewHash(imagePath) {
  const match = String(imagePath || "").match(/(?:infrastructure_)?photo_previews\/([^/?#]+)\.jpg/i);
  return match?.[1] || null;
}

export function loadWindowAssignments(dataDir, fileName) {
  const context = { window: {} };
  const script = vm.createContext(context);
  const absolutePath = path.join(dataDir, fileName);
  vm.runInContext(fs.readFileSync(absolutePath, "utf8"), script);
  return context.window;
}

export async function listPreviewHashes(previewDir) {
  const hashes = new Set();

  try {
    for (const entry of await fsPromises.readdir(previewDir, { withFileTypes: true })) {
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".jpg") continue;
      hashes.add(path.basename(entry.name, ".jpg"));
    }
  } catch {
    // Missing preview directory.
  }

  return hashes;
}

export function collectPreviewHashesFromRecords(records) {
  const hashes = new Set();

  for (const record of records) {
    const directHash = previewHash(record?.image);
    if (directHash) hashes.add(directHash);

    for (const photo of record?.photos || []) {
      const nestedHash = previewHash(photo?.image);
      if (nestedHash) hashes.add(nestedHash);
    }
  }

  return hashes;
}

export function preferCanonicalPhotoByHash(photos, preferredPathMarker = "") {
  const preferredCopies = preferredPathMarker
    ? photos.filter((photo) => String(photo.relativePath || photo.sourcePath || "").includes(preferredPathMarker))
    : [];
  const pool = preferredCopies.length ? preferredCopies : photos;

  return [...pool].sort((left, right) => {
    const leftLabel = left.fileName || left.title || "";
    const rightLabel = right.fileName || right.title || "";
    const byLength = rightLabel.length - leftLabel.length;
    if (byLength !== 0) return byLength;
    return leftLabel.localeCompare(rightLabel);
  })[0];
}

export function deduplicateRecordsByHash(records, { hashField = "hash", preferredPathMarker = "" } = {}) {
  const groups = new Map();

  for (const record of records) {
    const hash = record?.[hashField];
    if (!hash) continue;
    if (!groups.has(hash)) groups.set(hash, []);
    groups.get(hash).push(record);
  }

  const deduped = [];
  let removed = 0;

  for (const group of groups.values()) {
    if (group.length === 1) {
      deduped.push(group[0]);
      continue;
    }

    deduped.push(preferCanonicalPhotoByHash(group, preferredPathMarker));
    removed += group.length - 1;
  }

  return { deduped, removed };
}

export async function removeOrphanPreviewFiles(previewDir, referencedHashes) {
  let removed = 0;

  for (const entry of await fsPromises.readdir(previewDir, { withFileTypes: true })) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".jpg") continue;
    const hash = path.basename(entry.name, ".jpg");
    if (referencedHashes.has(hash)) continue;
    await fsPromises.unlink(path.join(previewDir, entry.name));
    removed += 1;
  }

  return removed;
}
