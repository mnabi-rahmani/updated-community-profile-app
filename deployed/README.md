# Community Priorities Map Data and Legacy Bundle

Standalone Leaflet map data for Baghlan-e-Jadid and Nawabad community priorities. The maintainable Community Priorities app source now lives in `frontend/community-priorities-src/`; this folder keeps the generated GIS/photo data and the legacy monolithic map used to seed that source.

Photo previews are **not** bundled with the frontend application for production; they are deployed separately to S3.

## Layout

```
deployed/
├── index.html                          # Legacy monolithic map page
├── package.json                        # Local dev server (npm run dev)
└── cursor_v2_map_data/
    ├── photo_backed_priorities.js      # 111 photo-backed priority points
    ├── layers_bundle.js                # 26 Integrated Locations Database layers
    ├── photo_index.js                  # field photos index + helpers
    ├── icons/                          # facility marker icons
    └── photo_previews/                 # Local source for S3 upload only — NOT deployed with frontend
```

## Local preview

```bash
cd deployed
npm install
npm run dev
```

Open http://localhost:5174 — map loads HTML/JS locally. For the packaged frontend source, use `frontend/community-priorities-src/` and `sync-community-priorities-map.ps1`.

## Photo Deployment (Separate S3)

Photos stay in `cursor_v2_map_data/photo_previews/` on disk. Upload separately:

```powershell
.\deploy-community-priorities-map-assets-to-s3.ps1
```

- **Default bucket:** `community-priorities-map-assets-<aws-account-id>-<region>`
- **Default prefix:** `community-priorities/priority-previews/`
- **Protected bucket:** `community-profile-app-cluster-pics` is explicitly blocked by the script.

The isolated app deployment writes `frontend/dist/community-priorities-map/src/config.js` with the separate asset base URL.

## Sync Into Frontend Dist (No Photos)

When packaging the Community Priorities source into the recovered frontend:

```powershell
.\sync-community-priorities-map.ps1
```

Copies `frontend/community-priorities-src/` plus generated data from `deployed/cursor_v2_map_data/` into `frontend/dist/community-priorities-map/`, excluding `photo_previews/`.

Then deploy the frontend separately.

## Isolated AWS Deployment

To deploy Community Priorities without touching the existing Community Profile CloudFront app:

```powershell
.\deploy-community-priorities-map-isolated-to-aws.ps1
```

This creates/uses separate resources:

- `community-priorities-map-app-<aws-account-id>-<region>` S3 app bucket
- `community-priorities-map-assets-<aws-account-id>-<region>` S3 image bucket
- a CloudFront distribution whose comment starts with `community-priorities-map-isolated-`

The script refuses to use the existing `d113s7v6pd04w6.cloudfront.net` distribution or the `community-profile-app-cluster-pics` bucket.
