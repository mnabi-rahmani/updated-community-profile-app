Param(
    [string]$SourceDir = $(Join-Path $PSScriptRoot "deployed"),
    [string]$TargetDir = $(Join-Path $PSScriptRoot "frontend\dist\community-priorities-map")
)

Write-Host "Source :" $SourceDir
Write-Host "Target :" $TargetDir

if (!(Test-Path $SourceDir)) {
    Write-Error "Source directory '$SourceDir' does not exist."
    exit 1
}

$requiredFiles = @(
    "index.html",
    "cursor_v2_map_data\photo_backed_priorities.js",
    "cursor_v2_map_data\layers_bundle.js",
    "cursor_v2_map_data\photo_index.js"
)

foreach ($file in $requiredFiles) {
    $path = Join-Path $SourceDir $file
    if (!(Test-Path $path)) {
        Write-Error "Required map runtime file missing: $path"
        exit 1
    }
}

if (Test-Path $TargetDir) {
    Remove-Item $TargetDir -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $TargetDir "cursor_v2_map_data") | Out-Null

$sourceIndex = Join-Path $SourceDir "index.html"
Copy-Item $sourceIndex (Join-Path $TargetDir "index.html") -Force
# The local frontend dev server uses `serve --single`, which rewrites nested .html files to
# the React SPA. This .htm alias remains directly accessible while using the same map runtime.
Copy-Item $sourceIndex (Join-Path $TargetDir "map.htm") -Force

$sourceDataDir = Join-Path $SourceDir "cursor_v2_map_data"
$targetDataDir = Join-Path $TargetDir "cursor_v2_map_data"

Copy-Item (Join-Path $sourceDataDir "photo_backed_priorities.js") (Join-Path $targetDataDir "photo_backed_priorities.js") -Force
Copy-Item (Join-Path $sourceDataDir "layers_bundle.js") (Join-Path $targetDataDir "layers_bundle.js") -Force
Copy-Item (Join-Path $sourceDataDir "photo_index.js") (Join-Path $targetDataDir "photo_index.js") -Force

$reviewReport = Join-Path $sourceDataDir "photo_backed_priorities_review.json"
if (Test-Path $reviewReport) {
    Copy-Item $reviewReport (Join-Path $targetDataDir "photo_backed_priorities_review.json") -Force
}

$iconsSource = Join-Path $sourceDataDir "icons"
if (Test-Path $iconsSource) {
    Copy-Item $iconsSource (Join-Path $targetDataDir "icons") -Recurse -Force
}

Write-Host "Done. Community priorities map packaged into frontend/dist/community-priorities-map."
Write-Host "Photo previews were intentionally excluded; deploy them separately with deploy-community-priorities-map-assets-to-s3.ps1."
