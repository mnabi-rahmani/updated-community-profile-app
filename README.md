# Community Profile App (Recovered)

Recovered from AWS deployment artifacts (March 2026). The frontend is the **production build** from S3; backend source was restored from Lambda source maps.

## Structure

- `backend/` — Serverless API (`community-profile-api`)
- `backend-ws/` — WebSocket service (`community-profile-ws`)
- `frontend/dist/` — Production React SPA (profiles, CFM cases, clusters mapping)
- `deployed/` — Standalone **Community Priorities Map** (Leaflet HTML app, separate from the React SPA)
- `recovered/` — Raw AWS deployment downloads (reference)

## Deployed endpoints (online)

| Service | URL |
|---------|-----|
| Dev API | https://tfqmwiadc8.execute-api.us-east-1.amazonaws.com |
| Prod API | https://vqcvab7nnc.execute-api.us-east-1.amazonaws.com |
| Frontend (CloudFront) | https://d113s7v6pd04w6.cloudfront.net |
| WebSocket | wss://gybggtdksl.execute-api.us-east-1.amazonaws.com/dev |
| Cluster photos (S3) | `community-profile-app-cluster-pics` bucket (online, not downloaded) |

The local frontend build is configured to call the **dev API** (`tfqmwiadc8`).

## Run locally (frontend against online API)

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 — the app talks to the deployed AWS API and S3 for images.

### Module logins (what you see in the nav)

The React app shows different sections based on your login **module**:

| User | Password | Module | Nav items |
|------|----------|--------|-----------|
| `cea_admin` | `Xk9#mP2$vL7@nQ4!` | CEA | Community Profiles only |
| `cfm_admin` | `Rw3&jF8*hT1%cB6^` | CFM | CFM Cases, CFM Dashboard |
| `clusters_admin` | `Gy5!zN9#pK2$wM8@` | clusters_map | Clusters Mapping |
| `super_admin` | `Qd7^sH4&xV0*bJ3%` | all | **All sections** |

If you logged in as `cea_admin`, CFM Cases will not appear — use `cfm_admin` or `super_admin` instead. CFM routes exist at `/cfm-cases` and `/cfm-dashboard` and the live API has case data.

## Community Priorities Map (`deployed/`)

This is the source for the Community Priorities Map module. The recovered frontend does not include React source (`.tsx`), so the map is packaged into the frontend distribution as a static module.

```bash
cd deployed
npm install
npm run dev
```

Open http://localhost:5174 — serves `deployed/index.html`.

To package the map into the frontend distribution:

```powershell
.\sync-community-priorities-map.ps1
```

The packaged map is available under:

```text
frontend/dist/community-priorities-map/map.htm
```

When the frontend dev server is running, open:

```text
http://localhost:5173/community-priorities-map/map.htm
```

Photo previews are intentionally excluded from the frontend bundle and must be deployed separately:

```powershell
.\deploy-community-priorities-map-assets-to-s3.ps1
```

Expected layout:

```
deployed/
  index.html
  cursor_v2_map_data/
    photo_backed_priorities.js   # priority points + FGD metadata
    layers_bundle.js             # Integrated Locations Database GeoJSON layers
    photo_index.js               # photo path index
```

**Recovery status:** The three `cursor_v2_map_data/*.js` files were **local build artifacts** and were not found on S3, OneDrive, or elsewhere on this machine. Placeholder stubs are in place so the page loads without 404s, but the map will show no priority markers until the real JS files are restored from a backup. Field photos remain online at `s3://community-profile-app-974389254535/community-priorities-map/Photos of Clusters and Sub-villages/` (108 preview JPEGs also exist in `community-profile-app-cluster-pics` under `cluster-pics/priority-previews/`).

## Backend development

```bash
cd backend
cp .env.example .env   # fill secrets from AWS Lambda env
npm install
npm run build            # TypeScript check
npm run deploy:dev       # deploy to AWS (optional)
```

## Recovery notes

- **43** API TypeScript files and **6** WebSocket handlers restored from source maps
- Frontend source (`.tsx`) was not recoverable; `frontend/dist` is the deployed bundle
- Images stay on S3 and are accessed via signed URLs from the API
