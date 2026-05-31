# Community Priorities Source

This folder contains the maintainable application source for the Community Priorities map only.

The source is intentionally plain HTML, CSS, and JavaScript because the existing production frontend has no recoverable React source yet. CFM Cases and Community Profile remain untouched in the recovered `frontend/dist` bundle.

## Files

```text
community-priorities-src/
├── index.html       # Map shell and sidebar markup
└── src/
    ├── config.js    # Runtime photo asset base URL; deployment overwrites this
    ├── app.js       # Leaflet map behavior, filters, popups, lightbox, layer controls
    └── styles.css   # Community Priorities map layout and visual design
```

Generated data is not stored here. The packaging script copies these files from `deployed/cursor_v2_map_data/`:

- `photo_backed_priorities.js`
- `layers_bundle.js`
- `photo_index.js`
- `photo_backed_priorities_review.json`, when present
- `icons/`, when present

Photo preview JPEGs are intentionally excluded from the frontend bundle and should be deployed separately with `deploy-community-priorities-map-assets-to-s3.ps1`.

The source app does not point to the existing Community Profile photo bucket. Isolated AWS deployment writes a separate asset URL into `src/config.js`.

## Package Into Frontend Dist

From the repository root:

```powershell
.\sync-community-priorities-map.ps1
```

Or from `frontend/`:

```powershell
npm run sync:priorities
```

The packaged map is written to `frontend/dist/community-priorities-map/`.

## Deploy To Separate AWS Resources

From the repository root:

```powershell
.\deploy-community-priorities-map-isolated-to-aws.ps1
```

Or from `frontend/`:

```powershell
npm run deploy:priorities:isolated
```

This deploys to separate `community-priorities-map-*` S3 buckets and a separate CloudFront distribution. It explicitly refuses to use the existing `d113s7v6pd04w6.cloudfront.net` distribution or `community-profile-app-cluster-pics` bucket.

## Regenerate From Legacy Map

If `deployed/index.html` is manually changed first, regenerate this split source with:

```powershell
node scripts/extract-community-priorities-source.mjs
```

Prefer editing this folder directly for new Community Priorities work.
