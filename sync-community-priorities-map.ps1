Param(
    [string]$SourceDir = $(Join-Path $PSScriptRoot "deployed"),
    [string]$TargetDir = $(Join-Path $PSScriptRoot "frontend\public\community-priorities-map")
)

Write-Host "Source :" $SourceDir
Write-Host "Target :" $TargetDir

if (!(Test-Path $SourceDir)) {
    Write-Error "Source directory '$SourceDir' does not exist."
    exit 1
}

New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null

robocopy $SourceDir $TargetDir /E `
    /XD photo_previews "Photos of Clusters and Sub-villages" node_modules `
    /XF INTEGRATION_EXPORT.md package.json package-lock.json `
    /NFL /NDL /NJH /NJS /nc /ns /np

if ($LASTEXITCODE -ge 8) {
    Write-Error "robocopy failed with exit code $LASTEXITCODE"
    exit 1
}

$previewTarget = Join-Path $TargetDir "cursor_v2_map_data\photo_previews"
if (Test-Path $previewTarget) {
    Remove-Item $previewTarget -Recurse -Force
    Write-Host "Removed stale photo_previews from target."
}

$photosTarget = Join-Path $TargetDir "Photos of Clusters and Sub-villages"
if (Test-Path $photosTarget) {
    Remove-Item $photosTarget -Recurse -Force
    Write-Host "Removed stale full-res Photos folder from target."
}

Write-Host "Done. Static map synced without photo assets (photos served from S3)."
