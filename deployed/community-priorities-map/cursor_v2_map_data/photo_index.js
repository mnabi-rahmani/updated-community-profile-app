// Placeholder index — replace with the real export when available.
window.CURSOR_V2_PHOTO_INDEX = [];

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
  return `
    <img class="popup-photo" src="${imageSrc}" alt="${safeTitle}" data-display-src="${imageSrc}">
    <h3 class="popup-title">${title}</h3>
    <div class="popup-meta">
      <span><strong>Photo:</strong> ${photo.fileName}</span>
      ${photo.village ? `<span><strong>Village:</strong> ${photo.village}</span>` : ""}
      ${photo.cluster ? `<span><strong>Cluster:</strong> ${photo.cluster}</span>` : ""}
      <span><strong>GPS:</strong> ${photo.lat.toFixed(8)}, ${photo.lon.toFixed(8)}</span>
      ${meta}
    </div>
  `;
};
