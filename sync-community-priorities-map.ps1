Param(
    [string]$SourceDir = $(Join-Path $PSScriptRoot "frontend\community-priorities-src"),
    [string]$DataDir = $(Join-Path $PSScriptRoot "deployed\cursor_v2_map_data"),
    [string]$TargetDir = $(Join-Path $PSScriptRoot "frontend\dist\community-priorities-map")
)

Write-Host "Source :" $SourceDir
Write-Host "Data   :" $DataDir
Write-Host "Target :" $TargetDir

if (!(Test-Path $SourceDir)) {
    Write-Error "Source directory '$SourceDir' does not exist."
    exit 1
}

$requiredSourceFiles = @(
    "index.html",
    "src\app.js",
    "src\config.js",
    "src\styles.css"
)

foreach ($file in $requiredSourceFiles) {
    $path = Join-Path $SourceDir $file
    if (!(Test-Path $path)) {
        Write-Error "Required Community Priorities source file missing: $path"
        exit 1
    }
}

if (!(Test-Path $DataDir)) {
    Write-Error "Data directory '$DataDir' does not exist."
    exit 1
}

$requiredDataFiles = @(
    "photo_backed_priorities.js",
    "layers_bundle.js",
    "photo_index.js"
)

foreach ($file in $requiredDataFiles) {
    $path = Join-Path $DataDir $file
    if (!(Test-Path $path)) {
        Write-Error "Required generated map data file missing: $path"
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
Copy-Item (Join-Path $SourceDir "src") (Join-Path $TargetDir "src") -Recurse -Force

$targetDataDir = Join-Path $TargetDir "cursor_v2_map_data"

Copy-Item (Join-Path $DataDir "photo_backed_priorities.js") (Join-Path $targetDataDir "photo_backed_priorities.js") -Force
Copy-Item (Join-Path $DataDir "layers_bundle.js") (Join-Path $targetDataDir "layers_bundle.js") -Force
Copy-Item (Join-Path $DataDir "photo_index.js") (Join-Path $targetDataDir "photo_index.js") -Force

$reviewReport = Join-Path $DataDir "photo_backed_priorities_review.json"
if (Test-Path $reviewReport) {
    Copy-Item $reviewReport (Join-Path $targetDataDir "photo_backed_priorities_review.json") -Force
}

$iconsSource = Join-Path $DataDir "icons"
if (Test-Path $iconsSource) {
    Copy-Item $iconsSource (Join-Path $targetDataDir "icons") -Recurse -Force
}

Write-Host "Done. Community priorities map packaged into frontend/dist/community-priorities-map."
Write-Host "Photo previews were intentionally excluded; deploy them separately with deploy-community-priorities-map-assets-to-s3.ps1."
