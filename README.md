# Community Profile App (Recovered)

Recovered from AWS deployment artifacts (March 2026). The frontend is the **production build** from S3; backend source was restored from Lambda source maps.

## Structure

- `backend/` — Serverless API (`community-profile-api`)
- `backend-ws/` — WebSocket service (`community-profile-ws`)
- `frontend/dist/` — Production React SPA (profiles, CFM cases, clusters mapping)
- `frontend/community-priorities-src/` — maintainable **Community Priorities Map** source
- `deployed/` — Community Priorities generated map data and legacy Leaflet HTML app
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

## Community Priorities Map

The Community Priorities Map source lives in `frontend/community-priorities-src/`. The recovered frontend does not include React source (`.tsx`) for the rest of the application, so CFM Cases and Community Profile are left as recovered `dist` code for now.

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

For an isolated AWS deployment that does **not** touch the existing CloudFront app at `https://d113s7v6pd04w6.cloudfront.net/clusters-mapping`, use:

```powershell
.\deploy-community-priorities-map-isolated-to-aws.ps1
```

That script creates/uses separate `community-priorities-map-*` S3 buckets and a separate CloudFront distribution. It refuses to deploy to the existing `community-profile-app-cluster-pics` bucket or the `d113s7v6pd04w6.cloudfront.net` distribution.

Expected layout:

```
deployed/
  index.html
  cursor_v2_map_data/
    photo_backed_priorities.js   # priority points + FGD metadata
    layers_bundle.js             # Integrated Locations Database GeoJSON layers
    photo_index.js               # photo path index
```

**Recovery status:** The Community Priorities data bundles have been regenerated from the local source assets under `deployed/Assets Needed/`. Preview JPEGs are treated as separate deployable assets and are not bundled into the frontend app.

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
