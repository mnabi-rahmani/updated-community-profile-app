const COMMUNITY_PRIORITIES_CONFIG = window.COMMUNITY_PRIORITIES_CONFIG || {};
    const AUTH_API_BASE_URL = (COMMUNITY_PRIORITIES_CONFIG.authApiBaseUrl || "https://tfqmwiadc8.execute-api.us-east-1.amazonaws.com").replace(/\/$/, "");
    const AUTH_ALLOWED_MODULES = new Set(COMMUNITY_PRIORITIES_CONFIG.allowedAuthModules || ["clusters_map", "all"]);
    const AUTH_STORAGE_KEY = "communityPrioritiesAuth";
    const rawPriorityPhotoBaseUrl = String(COMMUNITY_PRIORITIES_CONFIG.priorityPhotoBaseUrl || "").trim();
    const PRIORITY_PHOTO_BASE_URL = rawPriorityPhotoBaseUrl
      ? rawPriorityPhotoBaseUrl.replace(/\/?$/, "/")
      : "";
    const USE_LOCAL_PRIORITY_PHOTOS = ["localhost", "127.0.0.1", ""].includes(window.location.hostname)
      && !["/community-priorities-map/", "/cluster-priorities-map/"].some((path) => window.location.pathname.includes(path));

    const authScreen = document.getElementById("authScreen");
    const authForm = document.getElementById("authForm");
    const authUserId = document.getElementById("authUserId");
    const authPassword = document.getElementById("authPassword");
    const authSubmit = document.getElementById("authSubmit");
    const authMessage = document.getElementById("authMessage");
    const authUserPanel = document.getElementById("authUserPanel");
    const authUserLabel = document.getElementById("authUserLabel");
    const authLogout = document.getElementById("authLogout");

    function readStoredAuth() {
      try {
        return JSON.parse(window.localStorage.getItem(AUTH_STORAGE_KEY) || "null");
      } catch {
        return null;
      }
    }

    function storeAuth(authState) {
      window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(authState));
    }

    function clearStoredAuth() {
      window.localStorage.removeItem(AUTH_STORAGE_KEY);
    }

    function isAllowedUser(user) {
      return Boolean(user && AUTH_ALLOWED_MODULES.has(user.module));
    }

    function showAuthMessage(message) {
      if (!authMessage) return;
      authMessage.textContent = message;
      authMessage.hidden = false;
    }

    function clearAuthMessage() {
      if (!authMessage) return;
      authMessage.textContent = "";
      authMessage.hidden = true;
    }

    function showLogin() {
      if (authScreen) authScreen.hidden = false;
      if (authUserPanel) authUserPanel.hidden = true;
      authUserId?.focus();
    }

    function showAuthenticatedApp(user) {
      if (authScreen) authScreen.hidden = true;
      if (authUserPanel) authUserPanel.hidden = false;
      if (authUserLabel) {
        const moduleLabel = user.module === "all" ? "All Modules" : "Clusters Map";
        authUserLabel.textContent = `${user.name || user.userId} (${user.role} - ${moduleLabel})`;
      }
    }

    async function authRequest(path, options = {}) {
      const response = await fetch(`${AUTH_API_BASE_URL}${path}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(options.headers || {})
        }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false) {
        throw new Error(payload.message || "Authentication request failed.");
      }
      return payload.data || payload;
    }

    async function verifyStoredAuth() {
      const stored = readStoredAuth();
      if (!stored?.token) {
        showLogin();
        return;
      }
      try {
        const data = await authRequest("/auth/verify", {
          method: "GET",
          headers: { Authorization: `Bearer ${stored.token}` }
        });
        const user = data.user || stored.user;
        if (!data.valid || !isAllowedUser(user)) {
          clearStoredAuth();
          showLogin();
          return;
        }
        showAuthenticatedApp(user);
      } catch {
        clearStoredAuth();
        showLogin();
      }
    }

    authForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      clearAuthMessage();
      const userId = authUserId?.value.trim();
      const password = authPassword?.value || "";
      if (!userId || !password) {
        showAuthMessage("Enter both username and password.");
        return;
      }
      if (authSubmit) {
        authSubmit.disabled = true;
        authSubmit.textContent = "Signing in...";
      }
      try {
        const data = await authRequest("/auth/login", {
          method: "POST",
          body: JSON.stringify({ userId, password })
        });
        if (!isAllowedUser(data.user)) {
          clearStoredAuth();
          showAuthMessage("This user is not authorized for the Community Priorities map.");
          return;
        }
        storeAuth({ token: data.token, user: data.user, expiresIn: data.expiresIn });
        if (authPassword) authPassword.value = "";
        showAuthenticatedApp(data.user);
      } catch (error) {
        clearStoredAuth();
        showAuthMessage(error.message || "Invalid username or password.");
      } finally {
        if (authSubmit) {
          authSubmit.disabled = false;
          authSubmit.textContent = "Sign in";
        }
      }
    });

    authLogout?.addEventListener("click", () => {
      clearStoredAuth();
      showLogin();
    });

    verifyStoredAuth();

    function resolveAssetUrl(path) {
      if (!path) return "";
      if (/^(https?:|file:|blob:|data:)/i.test(path)) return path;
      const previewMatch = String(path).match(/(?:infrastructure_)?photo_previews\/([^/?#]+)/i);
      if (previewMatch) {
        if (USE_LOCAL_PRIORITY_PHOTOS) return encodeURI(path).replace(/#/g, "%23");
        if (PRIORITY_PHOTO_BASE_URL) return PRIORITY_PHOTO_BASE_URL + previewMatch[1];
      }
      return encodeURI(path).replace(/#/g, "%23");
    }

    if (typeof window.photoPopupHtml === "function") {
      const originalPhotoPopupHtml = window.photoPopupHtml;
      window.photoPopupHtml = function photoPopupHtml(photo, title, metaRows) {
        if (!photo) return originalPhotoPopupHtml(photo, title, metaRows);
        return originalPhotoPopupHtml(
          { ...photo, image: resolveAssetUrl(photo.image) },
          title,
          metaRows
        );
      };
    }

    const PRIORITIES_GLOBAL = COMMUNITY_PRIORITIES_CONFIG.prioritiesGlobal || "PHOTO_BACKED_PRIORITIES";
    const FILTERS_GLOBAL = COMMUNITY_PRIORITIES_CONFIG.filtersGlobal || "PHOTO_BACKED_FILTERS";
    const IS_INFRASTRUCTURE_DISPLAY = COMMUNITY_PRIORITIES_CONFIG.displayMode === "infrastructure";
    const ALL_PRIORITY_POINTS = window[PRIORITIES_GLOBAL] || window.PHOTO_BACKED_PRIORITIES || [];
    const AREA_PHOTOS_GLOBAL = COMMUNITY_PRIORITIES_CONFIG.areaPhotosGlobal || "";
    const AREA_PHOTO_RADIUS_METERS = Number(COMMUNITY_PRIORITIES_CONFIG.areaPhotoRadiusMeters) || 100;
    const ALL_AREA_PHOTOS = AREA_PHOTOS_GLOBAL ? (window[AREA_PHOTOS_GLOBAL] || []) : [];
    const priorityPointById = new Map(ALL_PRIORITY_POINTS.map((point) => [point.id, point]));
    const FILTER_META = window[FILTERS_GLOBAL] || window.PHOTO_BACKED_FILTERS || { clusters: [], villagesByCluster: {} };
    const STYLES = window.CURSOR_V2_STYLES || {};
    const LAYERS = window.CURSOR_V2_LAYERS || {};
    const MANIFEST = window.CURSOR_V2_LAYER_MANIFEST || [];

    function databaseManifestEntries() {
      const ids = COMMUNITY_PRIORITIES_CONFIG.includedLayerIds;
      if (!Array.isArray(ids) || !ids.length) return MANIFEST;
      const allowed = new Set(ids);
      return MANIFEST.filter((entry) => allowed.has(entry.id));
    }

    function initMapNav() {
      const nav = document.getElementById("mapNav");
      const items = COMMUNITY_PRIORITIES_CONFIG.navItems;
      const activeId = COMMUNITY_PRIORITIES_CONFIG.mapId;
      if (!nav || !Array.isArray(items) || !items.length) return;
      nav.innerHTML = items.map((item) => {
        const isActive = item.id === activeId;
        const activeClass = isActive ? " map-nav-link-active" : "";
        const ariaCurrent = isActive ? ' aria-current="page"' : "";
        return `<a href="${item.href}" class="map-nav-link${activeClass}"${ariaCurrent}>${item.label}</a>`;
      }).join("");
    }

    const priorityBadge = document.getElementById("priorityBadge");
    if (priorityBadge) {
      const databaseLayerCount = databaseManifestEntries().length;
      const priorityLabel = COMMUNITY_PRIORITIES_CONFIG.priorityCountLabel || "photo-backed priorities";
      const layerLabel = COMMUNITY_PRIORITIES_CONFIG.databaseLayerLabel || "Integrated Locations Database layers";
      priorityBadge.textContent = `${ALL_PRIORITY_POINTS.length} ${priorityLabel} + ${databaseLayerCount} ${layerLabel}`;
    }
    const BAGHLAN_CLUSTERS = new Set([
      "Cluster 1", "Cluster 2", "Cluster 3", "Cluster 4", "Cluster 5", "Cluster 6",
      "Cluster 7", "Cluster 8", "Cluster 9", "Cluster 10", "Cluster 11", "Nawabad Cluster"
    ]);

    const CLUSTER_STORIES = {
      "Cluster 3": "Flood-prone canals and river edges are threatening homes, public assets, roads, and daily services in Chah Abi Ha and Gudan Payen. The mapped database facilities and photo-backed priorities together show where protection walls, culverts, road rehabilitation, and safer learning spaces are needed.",
      "All": "Across Baghlan and Nawabad, community FGDs identified recurring needs around flood protection, WASH, education facilities, road access, health services, and shelter. Use the cluster and village filters to explore photo-backed evidence linked to each priority theme."
    };

    const map = L.map("map", { zoomControl: true, preferCanvas: true });

    function createBaseMap(name, url, options) {
      const layer = L.tileLayer(url, options);
      layer._baseMapName = name;
      return layer;
    }

    const BASE_MAP_OPTIONS = [
      {
        name: "OpenStreetMap",
        layer: createBaseMap(
          "OpenStreetMap",
          "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
          { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }
        )
      },
      {
        name: "Satellite imagery",
        layer: createBaseMap(
          "Satellite imagery",
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          { maxZoom: 19, attribution: "Tiles &copy; Esri" }
        )
      },
      {
        name: "Satellite + labels",
        layer: (() => {
          const group = L.layerGroup([
            createBaseMap(
              "Satellite + labels (imagery)",
              "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
              { maxZoom: 19, attribution: "Tiles &copy; Esri" }
            ),
            createBaseMap(
              "Satellite + labels (reference)",
              "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
              { maxZoom: 19, attribution: "Labels &copy; Esri", pane: "overlayPane" }
            )
          ]);
          group._baseMapName = "Satellite + labels";
          return group;
        })()
      },
      {
        name: "Topographic",
        layer: createBaseMap(
          "Topographic",
          "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
          { maxZoom: 17, attribution: "&copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap" }
        )
      },
      {
        name: "Light map",
        layer: createBaseMap(
          "Light map",
          "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
          { maxZoom: 20, attribution: "&copy; OpenStreetMap contributors &copy; CARTO" }
        )
      },
      {
        name: "Humanitarian OSM",
        layer: createBaseMap(
          "Humanitarian OSM",
          "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
          { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors, Tiles style by HOT" }
        )
      },
      {
        name: "Esri streets",
        layer: createBaseMap(
          "Esri streets",
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
          { maxZoom: 19, attribution: "Tiles &copy; Esri" }
        )
      }
    ];

    const BASE_MAP_LAYERS = Object.fromEntries(BASE_MAP_OPTIONS.map((entry) => [entry.name, entry.layer]));
    const DEFAULT_BASE_MAP = "OpenStreetMap";
    const DEFAULT_START_CLUSTER = "Cluster 1";
    const streets = BASE_MAP_LAYERS[DEFAULT_BASE_MAP];
    streets.addTo(map);

    const priorityGroup = L.layerGroup().addTo(map);
    const databaseStores = new Map();
    const markerById = new Map();
    const clusterFilter = document.getElementById("clusterFilter");
    const villageFilter = document.getElementById("villageFilter");
    const basemapFilter = document.getElementById("basemapFilter");
    const filterSummary = document.getElementById("filterSummary");
    const toggleAllLayersSidebar = document.getElementById("toggleAllLayersSidebar");
    const storyText = document.getElementById("storyText");
    const cards = document.getElementById("cards");
    const cardsEmpty = document.getElementById("cardsEmpty");
    const sideHeaderToggle = document.getElementById("sideHeaderToggle");
    const sideIntroPanel = document.getElementById("sideIntroPanel");
    const SIDE_INTRO_STORAGE_KEY = "communityPrioritiesSideIntroCollapsed";
    const layerControlEntries = { "Photo-backed priorities": priorityGroup };

    function setSideIntroCollapsed(collapsed) {
      if (!sideIntroPanel || !sideHeaderToggle) return;
      sideIntroPanel.hidden = collapsed;
      sideHeaderToggle.setAttribute("aria-expanded", String(!collapsed));
      const label = sideHeaderToggle.querySelector(".side-header-toggle-label");
      if (label) label.textContent = collapsed ? "Show panel" : "Hide panel";
      document.querySelector(".side")?.classList.toggle("side-intro-collapsed", collapsed);
      document.body.classList.toggle("side-panel-collapsed", collapsed);
      requestAnimationFrame(() => {
        map.invalidateSize({ animate: false });
        scheduleMapLayoutRefresh();
      });
      try {
        window.localStorage.setItem(SIDE_INTRO_STORAGE_KEY, collapsed ? "1" : "0");
      } catch {
        // Ignore storage failures in private browsing.
      }
    }

    function initSideHeaderToggle() {
      if (!sideHeaderToggle || !sideIntroPanel) return;
      let collapsed = false;
      try {
        collapsed = window.localStorage.getItem(SIDE_INTRO_STORAGE_KEY) === "1";
      } catch {
        collapsed = false;
      }
      setSideIntroCollapsed(collapsed);
      sideHeaderToggle.addEventListener("click", () => {
        setSideIntroCollapsed(!sideIntroPanel.hidden);
      });
    }

    let corridorLayer = null;
    let layersControl = null;
    let toggleAllLayersCheckbox = null;
    let toggleAllLayersListenersReady = false;
    const priorityGalleryStore = new Map();
    let lightboxPhotos = null;
    let lightboxIndex = 0;
    let lightboxCaption = "";
    let layoutRefreshQueued = false;

    const ZOOM_SHOW_PRIORITIES = 12;
    const ZOOM_SHOW_FACILITIES = 0;
    const ZOOM_SHOW_COMMUNITY_LABELS = 13;
    const DECLUTTER_GROUP_METERS = 14;
    const DECLUTTER_SPACING_PX = 30;

    function normalizeCluster(name) {
      if (name === "Naw Abad Cluster") return "Nawabad Cluster";
      return name;
    }

    const CLUSTER_NAME_PATTERN = /^(Cluster \d+|Naw Abad Cluster|Nawabad Cluster)$/i;

    function looksLikeClusterName(value) {
      return CLUSTER_NAME_PATTERN.test(String(value || "").trim());
    }

    function featureCluster(props) {
      for (const value of [props?.Cluster, props?.Cluster_1, props?.Name]) {
        if (!value) continue;
        const normalized = normalizeCluster(String(value).trim());
        if (looksLikeClusterName(normalized) || BAGHLAN_CLUSTERS.has(normalized)) {
          return normalized;
        }
      }
      return null;
    }

    function featureVillage(props) {
      if (props?.Village) return props.Village;
      const name1 = props?.Name_1;
      if (name1 && !looksLikeClusterName(name1)) return name1;
      return null;
    }

    function normalizeVillage(name) {
      return String(name || "")
        .toLowerCase()
        .replace(/\s+villlage\s*$/i, "")
        .replace(/\s+village\s*$/i, "")
        .replace(/\s+/g, " ")
        .trim();
    }

    function villageMatches(left, right) {
      if (!left || !right || right === "All") return right === "All";
      const a = normalizeVillage(left);
      const b = normalizeVillage(right);
      return a.includes(b) || b.includes(a);
    }

    function imageSrc(path) {
      return resolveAssetUrl(path);
    }

    function popupPhotoSrc(photoElement) {
      return photoElement.getAttribute("data-display-src")
        || photoElement.getAttribute("src")
        || photoElement.currentSrc
        || photoElement.src;
    }

    function markerLatLng(point) {
      return [point.lat + (point.offsetLat || 0), point.lon + (point.offsetLon || 0)];
    }

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

    function areaPhotosNear(lat, lon, radiusMeters = AREA_PHOTO_RADIUS_METERS) {
      if (!ALL_AREA_PHOTOS.length || lat == null || lon == null) return [];
      const nearbyPhotos = ALL_AREA_PHOTOS
        .map((photo) => ({
          ...photo,
          distanceMeters: haversineMeters(lat, lon, photo.lat, photo.lon)
        }))
        .filter((photo) => photo.distanceMeters <= radiusMeters)
        .sort((left, right) => left.distanceMeters - right.distanceMeters);

      if (!IS_INFRASTRUCTURE_DISPLAY) return nearbyPhotos;

      const seenImages = new Set();
      return nearbyPhotos.filter((photo) => {
        const imageKey = photo.image || "";
        if (seenImages.has(imageKey)) return false;
        seenImages.add(imageKey);
        return true;
      });
    }

    function infrastructureMetaHtml(point) {
      return `
        <span><strong>Priority intervention:</strong> ${escapeHtml(point.intervention || point.title)}</span>
        <span><strong>Location:</strong> ${escapeHtml(point.location || point.village)}</span>
        <span><strong>Priority level:</strong> ${escapeHtml(point.level)}</span>
        <span><strong>Latitude:</strong> ${Number(point.lat).toFixed(8)}</span>
        <span><strong>Longitude:</strong> ${Number(point.lon).toFixed(8)}</span>
      `;
    }

    function infrastructurePriorityPhotos(point) {
      if (Array.isArray(point.photos) && point.photos.length) {
        return point.photos;
      }
      return areaPhotosNear(point.lat, point.lon);
    }

    function infrastructurePopupHtml(point) {
      const nearbyPhotos = infrastructurePriorityPhotos(point);
      const areaLinkHtml = nearbyPhotos.length
        ? `<button type="button" class="popup-area-photos-link" data-point-id="${point.id}">View photos in the area (${nearbyPhotos.length})</button>`
        : `<p class="popup-area-photos-empty">No GPS-tagged photos within ${AREA_PHOTO_RADIUS_METERS} m of this priority.</p>`;

      return `
        <div class="popup-infrastructure" data-point-id="${point.id}">
          <h3 class="popup-title">${point.displayId}. ${escapeHtml(point.intervention || point.title)}</h3>
          <div class="popup-meta popup-gallery-meta">${infrastructureMetaHtml(point)}</div>
          <p class="popup-area-photos-note">
            Nearby photos are <strong>not verified</strong> as related to this priority. They were taken within
            ${AREA_PHOTO_RADIUS_METERS} m of the priority GPS point.
          </p>
          ${areaLinkHtml}
        </div>
      `;
    }

    function openAreaPhotosForPoint(point) {
      const nearbyPhotos = IS_INFRASTRUCTURE_DISPLAY
        ? infrastructurePriorityPhotos(point)
        : areaPhotosNear(point.lat, point.lon);
      if (!nearbyPhotos.length) return;
      lightboxCaption = `Photos near priority ${point.displayId}. These images may not relate to this priority; they were taken within ${AREA_PHOTO_RADIUS_METERS} m of the GPS point.`;
      openPhotoLightbox(
        nearbyPhotos.map((photo) => ({
          image: photo.image,
          title: photo.file,
          file: photo.file,
          lat: photo.lat,
          lon: photo.lon,
          distanceMeters: photo.distanceMeters
        })),
        0
      );
    }

    function anchorLatLng(lat, lon) {
      return L.latLng(lat, lon);
    }

    function applyScreenOffset(marker, anchor, dx, dy) {
      if (!marker || !anchor) return;
      const point = map.latLngToContainerPoint(anchor);
      marker.setLatLng(map.containerPointToLatLng([point.x + dx, point.y + dy]));
      marker._declutterPixelOffset = { dx, dy };
      const el = marker.getElement?.();
      if (el) {
        el.classList.add("declutter-offset");
      }
    }

    function resetDeclutterMarker(marker) {
      if (!marker?._declutterAnchor) return;
      marker.setLatLng(marker._declutterAnchor);
      marker._declutterPixelOffset = null;
      const el = marker.getElement?.();
      if (el) {
        el.classList.remove("declutter-offset");
      }
    }

    function forEachDeclutterMarker(callback) {
      priorityGroup.eachLayer((layer) => {
        if (layer === corridorLayer || !layer._declutterAnchor) return;
        callback(layer);
      });
      databaseStores.forEach((store) => {
        if (store.entry.geometry !== "point") return;
        store.group.eachLayer((layer) => {
          if (!layer._declutterAnchor) return;
          callback(layer);
        });
      });
    }

    function pixelLayout(count) {
      if (count <= 1) return [{ dx: 0, dy: 0 }];
      if (count === 2) {
        const half = DECLUTTER_SPACING_PX * 0.55;
        return [{ dx: -half, dy: 0 }, { dx: half, dy: 0 }];
      }
      const radius = DECLUTTER_SPACING_PX * 0.85;
      return Array.from({ length: count }, (_, index) => {
        const angle = ((Math.PI * 2 * index) / count) - (Math.PI / 2);
        return {
          dx: Math.cos(angle) * radius,
          dy: Math.sin(angle) * radius
        };
      });
    }

    function groupMarkersByProximity(items) {
      const parent = items.map((_, index) => index);
      function find(index) {
        return parent[index] === index ? index : (parent[index] = find(parent[index]));
      }
      function union(a, b) {
        parent[find(a)] = find(b);
      }

      for (let i = 0; i < items.length; i += 1) {
        for (let j = i + 1; j < items.length; j += 1) {
          const a = items[i].anchor;
          const b = items[j].anchor;
          if (haversineMeters(a.lat, a.lng, b.lat, b.lng) <= DECLUTTER_GROUP_METERS) {
            union(i, j);
          }
        }
      }

      const groups = new Map();
      items.forEach((item, index) => {
        const root = find(index);
        if (!groups.has(root)) groups.set(root, []);
        groups.get(root).push(item);
      });
      return [...groups.values()];
    }

    function collectVisiblePointMarkers() {
      const zoom = map.getZoom();
      const items = [];

      if (zoom >= ZOOM_SHOW_PRIORITIES && map.hasLayer(priorityGroup)) {
        priorityGroup.eachLayer((layer) => {
          if (layer === corridorLayer || !layer.getLatLng || !layer._declutterAnchor) return;
          items.push({ marker: layer, anchor: layer._declutterAnchor, weight: 0 });
        });
      }

      if (zoom >= ZOOM_SHOW_FACILITIES) {
        databaseStores.forEach((store) => {
          if (store.entry.geometry !== "point" || !map.hasLayer(store.group)) return;
          store.group.eachLayer((layer) => {
            if (!layer.getLatLng || !layer._declutterAnchor) return;
            items.push({ marker: layer, anchor: layer._declutterAnchor, weight: 1 });
          });
        });
      }

      return items;
    }

    function updateZoomVisibility() {
      const zoom = map.getZoom();
      const showPriorities = zoom >= ZOOM_SHOW_PRIORITIES;
      const showFacilities = zoom >= ZOOM_SHOW_FACILITIES;
      const showCommunityLabels = zoom >= ZOOM_SHOW_COMMUNITY_LABELS;
      const container = map.getContainer();

      container.classList.toggle("zoom-overview", zoom < ZOOM_SHOW_PRIORITIES);
      container.classList.toggle(
        "zoom-medium",
        zoom >= ZOOM_SHOW_PRIORITIES && zoom < ZOOM_SHOW_FACILITIES
      );

      if (map.hasLayer(priorityGroup)) {
        priorityGroup.eachLayer((layer) => {
          if (layer === corridorLayer) return;
          if (layer.setOpacity) layer.setOpacity(showPriorities ? 1 : 0);
          if (layer.options) layer.options.interactive = showPriorities;
        });
      }

      databaseStores.forEach((store) => {
        if (store.entry.id === "boundary_community") {
          store.group.eachLayer((layer) => {
            const tooltip = layer.getTooltip?.();
            const el = tooltip?.getElement?.();
            if (el) el.style.visibility = showCommunityLabels ? "visible" : "hidden";
          });
          return;
        }
        if (store.entry.geometry !== "point" || !map.hasLayer(store.group)) return;
        store.group.eachLayer((layer) => {
          if (layer.setOpacity) {
            layer.setOpacity(showFacilities ? 1 : 0);
          } else if (layer.setStyle) {
            layer.setStyle({
              opacity: showFacilities ? 0.9 : 0,
              fillOpacity: showFacilities ? 0.95 : 0
            });
          }
          if (layer.options) layer.options.interactive = showFacilities;
        });
      });
    }

    function applyDeclutter() {
      updateZoomVisibility();
      forEachDeclutterMarker(resetDeclutterMarker);

      const groups = groupMarkersByProximity(collectVisiblePointMarkers());
      groups.forEach((group) => {
        group.sort((left, right) => left.weight - right.weight);
        const offsets = pixelLayout(group.length);
        group.forEach((item, index) => {
          applyScreenOffset(item.marker, item.anchor, offsets[index].dx, offsets[index].dy);
        });
      });
    }

    function scheduleMapLayoutRefresh() {
      if (layoutRefreshQueued) return;
      layoutRefreshQueued = true;
      requestAnimationFrame(() => {
        layoutRefreshQueued = false;
        applyDeclutter();
      });
    }

    function styleForLayer(layerId) {
      return STYLES[layerId] || {};
    }

    function polygonStyle(layerId) {
      const style = styleForLayer(layerId);
      if (layerId === "boundary_cluster") {
        return {
          color: style.strokeColor || "#002673",
          weight: style.strokeWidth || 2,
          fillColor: style.fillColor || "#e9ffbe",
          fillOpacity: style.fillOpacity ?? 0.2,
          className: "non-interactive-boundary",
          interactive: false
        };
      }
      if (layerId === "boundary_community") {
        return {
          color: style.strokeColor || "#cccccc",
          weight: style.strokeWidth || 1,
          fillColor: style.fillColor || "#259070",
          fillOpacity: style.fillOpacity ?? 0,
          className: "non-interactive-boundary",
          interactive: false
        };
      }
      return {
        color: style.strokeColor || "#666666",
        weight: style.strokeWidth || 2,
        fillColor: style.fillColor || "#cccccc",
        fillOpacity: 0.08
      };
    }

    function lineStyle(layerId) {
      const style = styleForLayer(layerId);
      return {
        color: style.strokeColor || "#ffffff",
        weight: style.strokeWidth || 2,
        opacity: 0.9
      };
    }

    function pointStyle(layerId) {
      const style = styleForLayer(layerId);
      return {
        radius: style.pointRadius || 5,
        color: style.strokeColor || "#ffffff",
        weight: style.strokeWidth || 1.5,
        fillColor: style.fillColor || style.markerFill || "#333333",
        fillOpacity: 0.95
      };
    }

    function pointLayer(feature, latlng, layerId) {
      const style = styleForLayer(layerId);
      let layer;
      if (style.icon) {
        const iconSize = style.iconSize || [22, 22];
        layer = L.marker(latlng, {
          icon: L.icon({
            iconUrl: style.icon,
            iconSize,
            iconAnchor: [iconSize[0] / 2, iconSize[1] / 2],
            popupAnchor: [0, -iconSize[1] / 2],
            className: "facility-marker"
          })
        });
      } else {
        layer = L.circleMarker(latlng, pointStyle(layerId));
      }
      layer._declutterAnchor = latlng;
      layer._declutterKind = "facility";
      return layer;
    }

    function popupFromProps(layerId, props) {
      const rows = Object.entries(props || {})
        .filter(([key, value]) => value != null && !/^Shape_/i.test(key) && !/^(OBJECTID|Join_Count|TARGET_FID|Name_\d+|Cluster_\d+)$/i.test(key))
        .slice(0, 8)
        .map(([key, value]) => `<span><strong>${key}:</strong> ${value}</span>`)
        .join("");
      return `<strong>${MANIFEST.find((item) => item.id === layerId)?.label || layerId}</strong><div class="popup-meta">${rows || "<span>Integrated Locations Database feature</span>"}</div>`;
    }

    function pointPopupHtml(layerId, props, lat, lon) {
      const label = MANIFEST.find((item) => item.id === layerId)?.label || layerId;
      const name = props?.Name;
      const title = name ? `${label}: ${name}` : label;
      const extraMeta = Object.entries(props || {})
        .filter(([key, value]) => value != null && !/^Shape_/i.test(key) && !/^(OBJECTID|Join_Count|TARGET_FID|Name_\d+|Cluster_\d+)$/i.test(key) && key !== "Name")
        .slice(0, 5)
        .map(([key, value]) => `<span><strong>${key}:</strong> ${value}</span>`)
        .join("");
      const photo = typeof findPhotoAt === "function" ? findPhotoAt(lat, lon) : null;
      if (photo && typeof photoPopupHtml === "function") {
        return window.photoPopupHtml(photo, title, extraMeta);
      }
      return popupFromProps(layerId, props);
    }

    function bindBoundaryLabel(featureLayer, layerId, properties) {
      const label = properties?.Name;
      featureLayer.options.interactive = false;
      featureLayer.on("add", () => {
        const element = featureLayer.getElement?.();
        if (element) element.style.pointerEvents = "none";
      });
      if (!label) return;
      featureLayer.bindTooltip(label, {
        permanent: true,
        direction: "center",
        className: `boundary-label ${layerId === "boundary_cluster" ? "cluster-label" : "community-label"}`,
        opacity: 1
      });
    }

    function featureMatchesFilters(props, entry) {
      const cluster = clusterFilter.value;
      const village = villageFilter.value;

      if (entry.group === "Boundaries") {
        if (entry.id === "boundary_cluster") {
          if (cluster === "All") return BAGHLAN_CLUSTERS.has(normalizeCluster(props.Name));
          return normalizeCluster(props.Name) === cluster;
        }
        if (entry.id === "boundary_community") {
          if (cluster === "All") return true;
          return featureCluster(props) === cluster;
        }
        return true;
      }

      if (cluster !== "All") {
        const featureClusterValue = featureCluster(props);
        if (!featureClusterValue || featureClusterValue !== cluster) return false;
      }
      if (village !== "All") {
        const featureVillageValue = featureVillage(props);
        if (featureVillageValue && !villageMatches(featureVillageValue, village)) return false;
      }
      return true;
    }

    function rebuildDatabaseLayer(entry) {
      const store = databaseStores.get(entry.id);
      const geojson = LAYERS[entry.id];
      store.group.clearLayers();
      if (!geojson) return;

      const features = geojson.features.filter((feature) => featureMatchesFilters(feature.properties || {}, entry));
      L.geoJSON(
        { type: "FeatureCollection", features },
        {
          pointToLayer(feature, latlng) {
            return pointLayer(feature, latlng, entry.id);
          },
          style() {
            if (entry.geometry === "line") return lineStyle(entry.id);
            if (entry.geometry === "polygon") return polygonStyle(entry.id);
            return pointStyle(entry.id);
          },
          onEachFeature(feature, featureLayer) {
            if (entry.geometry === "point") {
              featureLayer.bindPopup(() => {
                const latlng = featureLayer.getLatLng();
                return pointPopupHtml(entry.id, feature.properties, latlng.lat, latlng.lng);
              }, { maxWidth: 320 });
            } else if (entry.id !== "boundary_community" && entry.id !== "boundary_cluster") {
              featureLayer.bindPopup(popupFromProps(entry.id, feature.properties));
            }
            if (entry.id === "boundary_cluster" || entry.id === "boundary_community") {
              bindBoundaryLabel(featureLayer, entry.id, feature.properties);
            }
          }
        }
      ).eachLayer((layer) => store.group.addLayer(layer));
      store.visibleCount = features.length;
    }

    function overlayLayerList() {
      return Object.values(layerControlEntries);
    }

    function syncToggleAllLayersInputs(checked, indeterminate) {
      [toggleAllLayersCheckbox, toggleAllLayersSidebar].forEach((input) => {
        if (!input) return;
        input.checked = checked;
        input.indeterminate = indeterminate;
      });
    }

    function updateToggleAllLayersCheckbox() {
      const layers = overlayLayerList();
      const visibleCount = layers.filter((layer) => map.hasLayer(layer)).length;
      syncToggleAllLayersInputs(
        visibleCount === layers.length,
        visibleCount > 0 && visibleCount < layers.length
      );
    }

    function setAllOverlaysVisible(visible) {
      overlayLayerList().forEach((layer) => {
        if (visible) {
          if (!map.hasLayer(layer)) map.addLayer(layer);
        } else if (map.hasLayer(layer)) {
          map.removeLayer(layer);
        }
      });
      updateToggleAllLayersCheckbox();
      scheduleMapLayoutRefresh();
    }

    function ensureToggleAllLayersCheckbox() {
      if (!layersControl) return;

      const container = layersControl.getContainer();
      if (!container) return;

      const section = container.querySelector(".leaflet-control-layers-list");
      const overlays = container.querySelector(".leaflet-control-layers-overlays");
      if (!section || !overlays) return;

      let label = section.querySelector("label.layer-toggle-all-label");
      if (!label) {
        label = L.DomUtil.create("label", "layer-toggle-all-label", section);
        toggleAllLayersCheckbox = L.DomUtil.create("input", "layer-toggle-all-input", label);
        toggleAllLayersCheckbox.type = "checkbox";
        toggleAllLayersCheckbox.checked = true;
        toggleAllLayersCheckbox.addEventListener("change", () => {
          setAllOverlaysVisible(toggleAllLayersCheckbox.checked);
        });

        const text = L.DomUtil.create("span", "", label);
        text.textContent = "All layers";

        section.insertBefore(label, overlays);
      }

      updateToggleAllLayersCheckbox();
    }

    function setupToggleAllLayersCheckbox(retryCount = 0) {
      if (!layersControl) return;

      const container = layersControl.getContainer();
      if (!container) {
        if (retryCount < 20) {
          setTimeout(() => setupToggleAllLayersCheckbox(retryCount + 1), 50);
        }
        return;
      }

      if (!container.querySelector(".leaflet-control-layers-overlays")) {
        if (retryCount < 20) {
          setTimeout(() => setupToggleAllLayersCheckbox(retryCount + 1), 50);
        }
        return;
      }

      if (!layersControl._toggleAllPatched) {
        const originalUpdate = layersControl._update.bind(layersControl);
        layersControl._update = function patchedLayerControlUpdate() {
          originalUpdate();
          ensureToggleAllLayersCheckbox();
        };
        layersControl._toggleAllPatched = true;
      }

      ensureToggleAllLayersCheckbox();

      if (!toggleAllLayersListenersReady) {
        toggleAllLayersListenersReady = true;
        map.on("layeradd layerremove", (event) => {
          if (overlayLayerList().includes(event.layer)) {
            updateToggleAllLayersCheckbox();
            scheduleMapLayoutRefresh();
          }
        });
      }
    }

    function initDatabaseLayers() {
      databaseManifestEntries().forEach((entry) => {
        if (!LAYERS[entry.id]) return;
        const group = L.layerGroup().addTo(map);
        databaseStores.set(entry.id, { entry, group, visibleCount: 0 });
        layerControlEntries[entry.label] = group;
        rebuildDatabaseLayer(entry);
      });

      layersControl = L.control.layers(
        BASE_MAP_LAYERS,
        layerControlEntries,
        { collapsed: true }
      ).addTo(map);

      setTimeout(() => setupToggleAllLayersCheckbox(), 0);
    }

    function pointPhotos(point) {
      if (point.photos && point.photos.length) return point.photos;
      return [{
        title: point.title,
        image: point.image,
        file: point.file,
        theme: point.theme,
        level: point.level,
        note: point.note,
        lat: point.lat,
        lon: point.lon
      }];
    }

    function countPriorityPhotos(points) {
      return points.reduce((total, point) => total + (point.photoCount || pointPhotos(point).length || 1), 0);
    }

    function escapeHtml(value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function galleryMetaHtml(point, photo) {
      if (IS_INFRASTRUCTURE_DISPLAY) {
        return infrastructureMetaHtml(point);
      }

      const sourceHtml = point.sourceDocument
        ? `<span><strong>Source:</strong> ${escapeHtml(point.sourceDocument)}</span>`
        : "";
      return `
        <span><strong>Cluster:</strong> ${escapeHtml(point.cluster)}</span>
        <span><strong>Village:</strong> ${escapeHtml(point.village)}</span>
        <span><strong>Theme:</strong> ${escapeHtml(photo.theme)}</span>
        <span><strong>Priority level:</strong> ${escapeHtml(photo.level)}</span>
        ${sourceHtml}
        <span><strong>GPS:</strong> ${photo.lat.toFixed(8)}, ${photo.lon.toFixed(8)}</span>
        <span><strong>Photo:</strong> ${escapeHtml(photo.file)}</span>
      `;
    }

    function syncGalleryPopup(galleryEl) {
      const pointId = Number(galleryEl.dataset.pointId);
      const photos = priorityGalleryStore.get(pointId);
      if (!photos?.length) return;

      const index = Number(galleryEl.dataset.photoIndex || 0);
      const photo = photos[index];
      const displayId = galleryEl.dataset.displayId;
      const image = galleryEl.querySelector(".popup-photo");
      const counter = galleryEl.querySelector(".gallery-counter");

      if (image) {
        image.src = imageSrc(photo.image);
        image.alt = photo.title || "Priority photo";
      }
      galleryEl.querySelector(".popup-title").textContent = IS_INFRASTRUCTURE_DISPLAY
        ? `${displayId}. ${galleryEl.dataset.intervention || photo.file || "Infrastructure priority"}`
        : `${displayId}. ${photo.title || photo.file}`;
      const noteEl = galleryEl.querySelector(".popup-gallery-note");
      if (noteEl) {
        noteEl.textContent = IS_INFRASTRUCTURE_DISPLAY ? "" : (photo.note || "");
        noteEl.hidden = IS_INFRASTRUCTURE_DISPLAY;
      }
      galleryEl.querySelector(".popup-gallery-meta").innerHTML = galleryMetaHtml(
        IS_INFRASTRUCTURE_DISPLAY
          ? {
            intervention: galleryEl.dataset.intervention,
            location: galleryEl.dataset.location,
            level: galleryEl.dataset.level,
            lat: Number(galleryEl.dataset.lat),
            lon: Number(galleryEl.dataset.lon),
            title: galleryEl.dataset.intervention,
            village: galleryEl.dataset.location
          }
          : {
            cluster: galleryEl.dataset.cluster,
            village: galleryEl.dataset.village,
            sourceDocument: galleryEl.dataset.sourceDocument
          },
        photo
      );
      if (counter) counter.textContent = `${index + 1} / ${photos.length}`;
    }

    function stepGalleryPopup(galleryEl, step) {
      const photos = priorityGalleryStore.get(Number(galleryEl.dataset.pointId));
      if (!photos?.length) return;
      const nextIndex = (Number(galleryEl.dataset.photoIndex || 0) + step + photos.length) % photos.length;
      galleryEl.dataset.photoIndex = String(nextIndex);
      syncGalleryPopup(galleryEl);
    }

    function popupHtml(point) {
      if (IS_INFRASTRUCTURE_DISPLAY) {
        return infrastructurePopupHtml(point);
      }

      const photos = pointPhotos(point);
      priorityGalleryStore.set(point.id, photos);
      const first = photos[0];
      const multi = photos.length > 1;
      const popupTitle = IS_INFRASTRUCTURE_DISPLAY
        ? `${point.displayId}. ${point.intervention || point.title}`
        : `${point.displayId}. ${escapeHtml(first.title || first.file || point.title)}`;
      const noteHtml = IS_INFRASTRUCTURE_DISPLAY
        ? ""
        : `<p class="popup-text popup-gallery-note">${escapeHtml(first.note || "")}</p>`;
      const photoBlock = first?.image
        ? `
          <div class="popup-gallery-frame">
            ${multi ? '<button type="button" class="gallery-btn gallery-prev" aria-label="Previous photo">&lsaquo;</button>' : ""}
            <img class="popup-photo" src="${imageSrc(first.image)}" alt="${escapeHtml(first.file || first.title || "Field photo")}" data-display-src="${imageSrc(first.image)}">
            ${multi ? '<button type="button" class="gallery-btn gallery-next" aria-label="Next photo">&rsaquo;</button>' : ""}
          </div>
          ${multi ? `<div class="gallery-counter">1 / ${photos.length}</div>` : ""}
        `
        : "";

      return `
        <div
          class="popup-gallery"
          data-point-id="${point.id}"
          data-display-id="${point.displayId}"
          data-photo-index="0"
          data-cluster="${escapeHtml(point.cluster)}"
          data-village="${escapeHtml(point.village)}"
          data-intervention="${escapeHtml(point.intervention || point.title)}"
          data-location="${escapeHtml(point.location || point.village)}"
          data-level="${escapeHtml(point.level)}"
          data-lat="${point.lat}"
          data-lon="${point.lon}"
          data-source-document="${escapeHtml(point.sourceDocument || "")}"
        >
          ${photoBlock}
          <h3 class="popup-title">${popupTitle}</h3>
          ${noteHtml}
          <div class="popup-meta popup-gallery-meta">${galleryMetaHtml(point, first || {})}</div>
        </div>
      `;
    }

    function markerIcon(point) {
      const countBadge = !IS_INFRASTRUCTURE_DISPLAY && point.photoCount > 1
        ? `<span class="priority-marker-count">${point.photoCount}</span>`
        : "";
      return L.divIcon({
        className: "",
        html: `<div class="priority-marker ${point.markerClass}">${point.displayId}${countBadge}</div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
        popupAnchor: [0, -17]
      });
    }

    function populateBasemapFilter() {
      basemapFilter.innerHTML = BASE_MAP_OPTIONS
        .map((entry) => `<option value="${entry.name}">${entry.name}</option>`)
        .join("");
      basemapFilter.value = DEFAULT_BASE_MAP;
    }

    function setBaseMap(name) {
      const target = BASE_MAP_LAYERS[name];
      if (!target || map.hasLayer(target)) return;
      BASE_MAP_OPTIONS.forEach((entry) => {
        if (map.hasLayer(entry.layer)) {
          map.removeLayer(entry.layer);
        }
      });
      target.addTo(map);
      basemapFilter.value = name;
    }

    function syncBasemapFilterFromMap(layer) {
      const name = layer?._baseMapName;
      if (name && basemapFilter.value !== name) {
        basemapFilter.value = name;
      }
    }

    function populateClusterFilter() {
      clusterFilter.innerHTML = [
        `<option value="All">All clusters</option>`,
        ...FILTER_META.clusters.map((cluster) => `<option value="${cluster}">${cluster}</option>`)
      ].join("");
      clusterFilter.value = "All";
    }

    function populateVillageFilter() {
      const selectedCluster = clusterFilter.value;
      const villages = selectedCluster === "All"
        ? FILTER_META.villagesByCluster.All || []
        : FILTER_META.villagesByCluster[selectedCluster] || [];
      villageFilter.innerHTML = [
        `<option value="All">${IS_INFRASTRUCTURE_DISPLAY ? "All locations" : "All villages"}</option>`,
        ...villages.map((village) => `<option value="${village}">${village}</option>`)
      ].join("");
    }

    function filteredPriorityPoints() {
      const cluster = clusterFilter.value;
      const village = villageFilter.value;
      const clusterCounters = new Map();
      return ALL_PRIORITY_POINTS
        .filter((point) => {
          const clusterMatch = cluster === "All" || point.cluster === cluster;
          const villageMatch = village === "All" || villageMatches(point.village, village);
          return clusterMatch && villageMatch;
        })
        .map((point) => {
          const next = (clusterCounters.get(point.cluster) || 0) + 1;
          clusterCounters.set(point.cluster, next);
          return { ...point, displayId: next };
        });
    }

    function updateStoryText() {
      if (!storyText) return;
      if (IS_INFRASTRUCTURE_DISPLAY) {
        storyText.textContent = "";
        storyText.closest(".section")?.setAttribute("hidden", "");
        return;
      }
      storyText.closest(".section")?.removeAttribute("hidden");
      const cluster = clusterFilter.value;
      const points = filteredPriorityPoints();
      if (CLUSTER_STORIES[cluster]) {
        storyText.textContent = CLUSTER_STORIES[cluster];
        return;
      }
      if (!points.length) {
        storyText.textContent = "No photo-backed priorities match the current filter. Adjust the cluster or village selection to view community evidence.";
        return;
      }
      const themes = [...new Set(points.map((point) => point.theme))].slice(0, 4).join("; ");
      storyText.textContent = `${cluster} community FGDs flagged ${points.length} photo-backed priority locations (${countPriorityPhotos(points)} field photos) across ${new Set(points.map((point) => point.village)).size} villages. Dominant themes include ${themes}. Click any numbered marker or sidebar card to browse linked field photos and priority notes.`;
    }

    function selectPoint(point) {
      document.querySelectorAll(".card").forEach((card) => {
        card.classList.toggle("active", Number(card.dataset.id) === point.id);
      });
      const marker = markerById.get(point.id);
      const target = marker?.getLatLng?.() || markerLatLng(point);
      map.setView(target, Math.max(map.getZoom(), 17), { animate: true });
      marker?.openPopup();
    }

    function renderPriorityCards(points) {
      cards.innerHTML = "";
      cardsEmpty.hidden = points.length > 0;
      points.forEach((point) => {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "card";
        card.dataset.id = String(point.id);
        card.innerHTML = `
          ${!IS_INFRASTRUCTURE_DISPLAY && point.image ? `<img src="${imageSrc(point.image)}" alt="">` : `<span class="card-photo-placeholder" aria-hidden="true"></span>`}
          <span>
            <strong>${point.displayId}. ${IS_INFRASTRUCTURE_DISPLAY ? escapeHtml(point.intervention || point.title) : point.title}</strong>
            <span>${point.cluster}${IS_INFRASTRUCTURE_DISPLAY ? "" : ` · ${point.village}`}</span>
            <span>${IS_INFRASTRUCTURE_DISPLAY ? escapeHtml(point.location || point.village) : `${point.theme} · ${point.level}`}</span>
            ${IS_INFRASTRUCTURE_DISPLAY ? `<span>${escapeHtml(point.level)}</span>` : ""}
            ${!IS_INFRASTRUCTURE_DISPLAY && point.photoCount > 1 ? `<span class="card-photo-count">${point.photoCount} photos</span>` : ""}
          </span>
        `;
        card.addEventListener("click", () => selectPoint(point));
        cards.appendChild(card);
      });
    }

    function renderPriorityMarkers(points) {
      priorityGroup.clearLayers();
      points.forEach((point) => {
        let marker = markerById.get(point.id);
        if (!marker) {
          marker = L.marker(markerLatLng(point), {
            icon: markerIcon(point),
            title: point.title,
            zIndexOffset: 1000 + point.id
          }).bindPopup(() => popupHtml(point), { maxWidth: 320 });
          markerById.set(point.id, marker);
        } else {
          marker.setLatLng(markerLatLng(point));
          marker.setIcon(markerIcon(point));
          marker.setPopupContent(popupHtml(point));
        }
        marker._declutterAnchor = anchorLatLng(point.lat, point.lon);
        marker._declutterKind = "priority";
        marker.addTo(priorityGroup);
      });

      if (clusterFilter.value === "Cluster 3" && villageFilter.value === "All") {
        if (!corridorLayer) {
          corridorLayer = L.polyline(
            [
              [36.208832, 68.759156],
              [36.208123, 68.76747697],
              [36.211308, 68.76527197]
            ],
            { color: "#f2c36b", weight: 4, opacity: 0.85, dashArray: "9 8" }
          );
          corridorLayer.bindTooltip("Priority corridor: school, culvert/access, flood protection", { sticky: true });
        }
        priorityGroup.addLayer(corridorLayer);
      }
    }

    function countVisibleFacilities() {
      let total = 0;
      databaseStores.forEach((store) => {
        if (store.entry.group !== "Boundaries") total += store.visibleCount || 0;
      });
      return total;
    }

    function boundsFromFeatures(features) {
      if (!features.length) return null;
      const bounds = L.geoJSON({ type: "FeatureCollection", features }).getBounds();
      return bounds.isValid() ? bounds : null;
    }

    function baghlanClusterBoundaries(clusterName) {
      const geojson = LAYERS.boundary_cluster;
      if (!geojson) return [];
      return geojson.features.filter((feature) => {
        const name = normalizeCluster(feature.properties?.Name);
        if (clusterName && clusterName !== "All") return name === clusterName;
        return BAGHLAN_CLUSTERS.has(name);
      });
    }

    function communityBoundaries(cluster, village) {
      const geojson = LAYERS.boundary_community;
      if (!geojson) return [];
      return geojson.features.filter((feature) => {
        const props = feature.properties || {};
        if (!props.Name || !villageMatches(props.Name, village)) return false;
        if (cluster === "All") return true;
        const featureClusterValue = featureCluster(props);
        return !featureClusterValue || featureClusterValue === cluster;
      });
    }

    function fitToVisiblePoints(points) {
      const boundsPoints = [...points.map((point) => markerLatLng(point))];
      databaseStores.forEach((store) => {
        if (store.entry.group === "Boundaries") return;
        store.group.eachLayer((layer) => {
          if (typeof layer.getLatLng === "function") {
            boundsPoints.push(layer.getLatLng());
          }
        });
      });
      if (!boundsPoints.length) return null;
      return L.latLngBounds(boundsPoints);
    }

    function fitToClusterBoundary(clusterName, { animate = true } = {}) {
      const bounds = boundsFromFeatures(baghlanClusterBoundaries(clusterName));
      if (!bounds) return;
      map.fitBounds(bounds.pad(0.12), { animate });
    }

    function fitToSelection(points) {
      const cluster = clusterFilter.value;
      const village = villageFilter.value;
      const isFiltered = cluster !== "All" || village !== "All";
      let bounds = null;

      if (village !== "All") {
        bounds = boundsFromFeatures(communityBoundaries(cluster, village));
      } else if (cluster !== "All") {
        bounds = boundsFromFeatures(baghlanClusterBoundaries(cluster));
      } else {
        bounds = boundsFromFeatures(baghlanClusterBoundaries("All"));
      }

      if (!bounds) {
        bounds = fitToVisiblePoints(points);
      }
      if (!bounds) return;

      map.fitBounds(bounds.pad(isFiltered ? 0.12 : 0.08), { animate: isFiltered });
    }

    function applyFilters(shouldFitBounds) {
      databaseStores.forEach((store) => rebuildDatabaseLayer(store.entry));
      const points = filteredPriorityPoints();
      renderPriorityMarkers(points);
      renderPriorityCards(points);
      updateStoryText();
      filterSummary.textContent = IS_INFRASTRUCTURE_DISPLAY
        ? `Showing ${points.length} infrastructure priorities. Use each popup to browse nearby photos within ${AREA_PHOTO_RADIUS_METERS} m.`
        : `Showing ${points.length} priority locations (${countPriorityPhotos(points)} of ${ALL_PRIORITY_POINTS.reduce((total, point) => total + (point.photoCount || pointPhotos(point).length || 1), 0)} photos) and ${countVisibleFacilities()} Integrated Locations Database features`;
      if (shouldFitBounds) fitToSelection(points);
      scheduleMapLayoutRefresh();
    }

    function initPriorityMarkers() {
      ALL_PRIORITY_POINTS.forEach((point) => {
        markerById.set(
          point.id,
          L.marker(markerLatLng(point), { icon: markerIcon({ ...point, displayId: point.id }), title: point.title })
            .bindPopup("", { maxWidth: 320 })
        );
      });
    }

    populateBasemapFilter();
    populateClusterFilter();
    populateVillageFilter();
    initMapNav();
    initSideHeaderToggle();
    initPriorityMarkers();
    initDatabaseLayers();
    applyFilters(false);
    fitToClusterBoundary(DEFAULT_START_CLUSTER, { animate: false });

    map.on("baselayerchange", (event) => {
      syncBasemapFilterFromMap(event.layer);
    });
    map.on("zoomend moveend", scheduleMapLayoutRefresh);
    scheduleMapLayoutRefresh();

    basemapFilter.addEventListener("change", () => {
      setBaseMap(basemapFilter.value);
    });

    clusterFilter.addEventListener("change", () => {
      populateVillageFilter();
      applyFilters(true);
    });
    villageFilter.addEventListener("change", () => applyFilters(true));

    toggleAllLayersSidebar.addEventListener("change", () => {
      setAllOverlaysVisible(toggleAllLayersSidebar.checked);
    });

    const photoLightbox = document.getElementById("photoLightbox");
    const photoLightboxImage = photoLightbox.querySelector(".photo-lightbox-image");
    const photoLightboxMessage = photoLightbox.querySelector(".photo-lightbox-message");
    const photoLightboxClose = photoLightbox.querySelector(".photo-lightbox-close");
    const photoLightboxPrev = photoLightbox.querySelector(".photo-lightbox-prev");
    const photoLightboxNext = photoLightbox.querySelector(".photo-lightbox-next");
    const photoLightboxCounter = photoLightbox.querySelector(".photo-lightbox-counter");
    const photoLightboxCaption = photoLightbox.querySelector(".photo-lightbox-caption");

    function renderLightboxSlide() {
      if (!lightboxPhotos?.length) return;
      const photo = lightboxPhotos[lightboxIndex];
      const src = imageSrc(photo.image);
      photoLightboxImage.hidden = false;
      photoLightboxMessage.hidden = true;
      photoLightboxImage.onload = () => {
        photoLightboxImage.hidden = false;
        photoLightboxMessage.hidden = true;
      };
      photoLightboxImage.onerror = () => {
        photoLightboxImage.hidden = true;
        photoLightboxMessage.hidden = false;
        photoLightboxMessage.textContent = photo.title
          ? `Unable to load "${photo.title}". The linked field photo may need its preview regenerated.`
          : "Unable to load this photo preview.";
      };
      photoLightboxImage.src = src;
      photoLightboxImage.alt = photo.title || photo.file || "Expanded field photo";
      const multi = lightboxPhotos.length > 1;
      photoLightboxPrev.hidden = !multi;
      photoLightboxNext.hidden = !multi;
      photoLightboxCounter.hidden = !multi;
      if (multi) {
        photoLightboxCounter.textContent = `${lightboxIndex + 1} / ${lightboxPhotos.length}`;
      }
      if (photoLightboxCaption) {
        const fileLabel = photo.file || photo.title || "";
        const distanceLabel = Number.isFinite(photo.distanceMeters)
          ? ` · ${Math.round(photo.distanceMeters)} m from priority`
          : "";
        const captionParts = [lightboxCaption, fileLabel ? `${fileLabel}${distanceLabel}` : ""]
          .filter(Boolean);
        photoLightboxCaption.textContent = captionParts.join(" ");
        photoLightboxCaption.hidden = !captionParts.length;
      }
    }

    function openPhotoLightbox(photos, index) {
      lightboxPhotos = photos;
      lightboxIndex = index;
      renderLightboxSlide();
      photoLightbox.hidden = false;
      document.body.style.overflow = "hidden";
    }

    function closePhotoLightbox() {
      photoLightbox.hidden = true;
      photoLightboxImage.removeAttribute("src");
      photoLightboxImage.alt = "";
      photoLightboxImage.hidden = false;
      photoLightboxImage.onload = null;
      photoLightboxImage.onerror = null;
      photoLightboxMessage.hidden = true;
      if (photoLightboxCaption) {
        photoLightboxCaption.textContent = "";
        photoLightboxCaption.hidden = true;
      }
      lightboxPhotos = null;
      lightboxIndex = 0;
      lightboxCaption = "";
      document.body.style.overflow = "";
    }

    function stepLightbox(step) {
      if (!lightboxPhotos?.length) return;
      lightboxIndex = (lightboxIndex + step + lightboxPhotos.length) % lightboxPhotos.length;
      renderLightboxSlide();
    }

    document.addEventListener("click", (event) => {
      const areaPhotosLink = event.target.closest(".popup-area-photos-link");
      if (areaPhotosLink) {
        event.preventDefault();
        event.stopPropagation();
        const point = priorityPointById.get(Number(areaPhotosLink.dataset.pointId));
        if (point) openAreaPhotosForPoint(point);
        return;
      }

      const prevBtn = event.target.closest(".gallery-prev");
      const nextBtn = event.target.closest(".gallery-next");
      if (prevBtn || nextBtn) {
        event.preventDefault();
        event.stopPropagation();
        const galleryEl = (prevBtn || nextBtn).closest(".popup-gallery");
        if (galleryEl) stepGalleryPopup(galleryEl, prevBtn ? -1 : 1);
        return;
      }

      const photo = event.target.closest(".popup-photo");
      if (!photo) return;
      event.preventDefault();
      event.stopPropagation();
      const galleryEl = photo.closest(".popup-gallery");
      if (galleryEl) {
        const photos = priorityGalleryStore.get(Number(galleryEl.dataset.pointId));
        const index = Number(galleryEl.dataset.photoIndex || 0);
        if (photos?.length) {
          openPhotoLightbox(photos, index);
          return;
        }
      }
      openPhotoLightbox([{
        image: popupPhotoSrc(photo),
        title: photo.getAttribute("alt") || photo.alt || "Field photo"
      }], 0);
    });

    photoLightboxClose.addEventListener("click", closePhotoLightbox);
    photoLightboxPrev.addEventListener("click", (event) => {
      event.stopPropagation();
      stepLightbox(-1);
    });
    photoLightboxNext.addEventListener("click", (event) => {
      event.stopPropagation();
      stepLightbox(1);
    });
    photoLightbox.addEventListener("click", (event) => {
      if (event.target === photoLightbox) closePhotoLightbox();
    });
    document.addEventListener("keydown", (event) => {
      if (photoLightbox.hidden) return;
      if (event.key === "Escape") closePhotoLightbox();
      if (event.key === "ArrowLeft") stepLightbox(-1);
      if (event.key === "ArrowRight") stepLightbox(1);
    });
