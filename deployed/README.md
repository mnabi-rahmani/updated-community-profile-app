# Community Priorities Map (deployed bundle)

Standalone Leaflet map for Baghlan-e-Jadid and Nawabad community priorities. This folder is the **source of truth** for the static map — photos are **not** bundled here for production; they are served from S3.

## Layout

```
deployed/
├── index.html                          # Main map page
├── package.json                        # Local dev server (npm run dev)
└── cursor_v2_map_data/
    ├── photo_backed_priorities.js      # 86 priority points (restore real file from backup)
    ├── layers_bundle.js                # 17 DB layers GeoJSON (restore real file from backup)
    ├── photo_index.js                  # 347 field photos index + helpers
    ├── icons/                          # 16 PNG facility markers (restore from backup)
    └── photo_previews/                 # Local source for S3 upload only — NOT deployed with frontend
```

## Local preview

```bash
cd deployed
npm install
npm run dev
```

Open http://localhost:5174 — map loads HTML/JS locally; **photo previews load from S3** via `PRIORITY_PHOTO_BASE_URL` in `index.html`.

## Photo deployment (S3)

Photos stay in `cursor_v2_map_data/photo_previews/` on disk. Upload separately:

```powershell
.\deploy-priority-previews-to-s3.ps1
```

- **Bucket:** `community-profile-app-cluster-pics`
- **Prefix:** `cluster-pics/priority-previews/`
- **Public URL:** `https://community-profile-app-cluster-pics.s3.us-east-1.amazonaws.com/cluster-pics/priority-previews/{filename}.jpg`

The map resolves paths like `cursor_v2_map_data/photo_previews/abc123.jpg` to that S3 base URL automatically.

## Sync into React frontend (no photos)

When integrating with the Community Profile App:

```powershell
.\sync-community-priorities-map.ps1
```

Copies `deployed/` → `frontend/public/community-priorities-map/` excluding:
- `photo_previews/`
- `Photos of Clusters and Sub-villages/`
- `node_modules/`

Then deploy the frontend separately.

## Recovery note

The three large data bundles (`photo_backed_priorities.js`, `layers_bundle.js`, full `photo_index.js`) were local build artifacts not found on S3. Placeholder stubs are in place — replace them with the real exports from the North East Mapping project backup to restore all 86 priority markers and 17 database layers.
