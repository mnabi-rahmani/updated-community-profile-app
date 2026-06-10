Param(
    [string]$SourceDir = $(Join-Path $PSScriptRoot "frontend\cluster-priorities-src"),
    [string]$SharedSourceDir = $(Join-Path $PSScriptRoot "frontend\community-priorities-src"),
    [string]$DataDir = $(Join-Path $PSScriptRoot "deployed\cursor_v2_map_data"),
    [string]$TargetDir = $(Join-Path $PSScriptRoot "frontend\dist\cluster-priorities-map")
)

Write-Host "Source :" $SourceDir
Write-Host "Shared :" $SharedSourceDir
Write-Host "Data   :" $DataDir
Write-Host "Target :" $TargetDir

if (!(Test-Path $SourceDir)) {
    Write-Error "Source directory '$SourceDir' does not exist."
    exit 1
}

if (!(Test-Path $SharedSourceDir)) {
    Write-Error "Shared source directory '$SharedSourceDir' does not exist."
    exit 1
}

$requiredSourceFiles = @(
    "index.html",
    "src\config.js"
)

foreach ($file in $requiredSourceFiles) {
    $path = Join-Path $SourceDir $file
    if (!(Test-Path $path)) {
        Write-Error "Required Cluster Priorities source file missing: $path"
        exit 1
    }
}

$requiredSharedFiles = @(
    "src\app.js",
    "src\styles.css"
)

foreach ($file in $requiredSharedFiles) {
    $path = Join-Path $SharedSourceDir $file
    if (!(Test-Path $path)) {
        Write-Error "Required shared map source file missing: $path"
        exit 1
    }
}

if (!(Test-Path $DataDir)) {
    Write-Error "Data directory '$DataDir' does not exist."
    exit 1
}

$requiredDataFiles = @(
    "infrastructure_priorities.js",
    "infrastructure_area_photos.js",
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
New-Item -ItemType Directory -Force -Path (Join-Path $TargetDir "src") | Out-Null

$sourceIndex = Join-Path $SourceDir "index.html"
Copy-Item $sourceIndex (Join-Path $TargetDir "index.html") -Force
Copy-Item $sourceIndex (Join-Path $TargetDir "map.htm") -Force
Copy-Item (Join-Path $SourceDir "src\config.js") (Join-Path $TargetDir "src\config.js") -Force
Copy-Item (Join-Path $SharedSourceDir "src\app.js") (Join-Path $TargetDir "src\app.js") -Force
Copy-Item (Join-Path $SharedSourceDir "src\styles.css") (Join-Path $TargetDir "src\styles.css") -Force

$targetDataDir = Join-Path $TargetDir "cursor_v2_map_data"

Copy-Item (Join-Path $DataDir "infrastructure_priorities.js") (Join-Path $targetDataDir "infrastructure_priorities.js") -Force
Copy-Item (Join-Path $DataDir "infrastructure_area_photos.js") (Join-Path $targetDataDir "infrastructure_area_photos.js") -Force
Copy-Item (Join-Path $DataDir "layers_bundle.js") (Join-Path $targetDataDir "layers_bundle.js") -Force
Copy-Item (Join-Path $DataDir "photo_index.js") (Join-Path $targetDataDir "photo_index.js") -Force

$reviewReport = Join-Path $DataDir "infrastructure_priorities_review.json"
if (Test-Path $reviewReport) {
    Copy-Item $reviewReport (Join-Path $targetDataDir "infrastructure_priorities_review.json") -Force
}

$previewSource = Join-Path $DataDir "infrastructure_photo_previews"
if (Test-Path $previewSource) {
    Copy-Item $previewSource (Join-Path $targetDataDir "infrastructure_photo_previews") -Recurse -Force
}

$iconsSource = Join-Path $DataDir "icons"
if (Test-Path $iconsSource) {
    Copy-Item $iconsSource (Join-Path $targetDataDir "icons") -Recurse -Force
}

Write-Host "Done. Cluster priorities map packaged into frontend/dist/cluster-priorities-map."
