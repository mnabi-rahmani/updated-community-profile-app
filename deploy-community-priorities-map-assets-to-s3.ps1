Param(
    [string]$BucketName = "community-profile-app-cluster-pics",
    [string]$Region = "us-east-1",
    [string]$SourceDir = $(Join-Path $PSScriptRoot "deployed\cursor_v2_map_data\photo_previews"),
    [string]$Prefix = "cluster-pics/priority-previews",
    [string]$CacheControl = "public,max-age=31536000,immutable"
)

Write-Host "Community priorities map asset deployment"
Write-Host "Bucket       :" $BucketName
Write-Host "Region       :" $Region
Write-Host "SourceDir    :" $SourceDir
Write-Host "S3 Prefix    :" $Prefix
Write-Host "Cache-Control:" $CacheControl

if (!(Get-Command aws -ErrorAction SilentlyContinue)) {
    Write-Error "AWS CLI was not found. Install/configure AWS CLI before deploying map image assets."
    exit 1
}

if (!(Test-Path $SourceDir)) {
    Write-Error "Source directory '$SourceDir' does not exist. Run 'npm run generate:data' in deployed/ first."
    exit 1
}

$fileCount = (Get-ChildItem -Path $SourceDir -File -Filter "*.jpg" -ErrorAction SilentlyContinue).Count
if ($fileCount -eq 0) {
    Write-Error "No preview JPEG files found under '$SourceDir'."
    exit 1
}

Write-Host "Found $fileCount preview JPEG(s)."
Write-Host "Checking bucket access..."

aws s3api head-bucket --bucket $BucketName 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Error "Bucket '$BucketName' was not found or is not accessible with the current AWS credentials."
    exit 1
}

$destination = "s3://$BucketName/$Prefix"
Write-Host "Syncing map image assets to $destination ..."

aws s3 sync $SourceDir $destination `
    --region $Region `
    --exclude "*" `
    --include "*.jpg" `
    --content-type "image/jpeg" `
    --cache-control $CacheControl `
    --delete

if ($LASTEXITCODE -ne 0) {
    Write-Error "aws s3 sync failed. Check AWS credentials, bucket policy, and network access."
    exit $LASTEXITCODE
}

$publicBaseUrl = "https://$BucketName.s3.$Region.amazonaws.com/$Prefix"

Write-Host "Done."
Write-Host "Public base URL: $publicBaseUrl"
Write-Host ""
Write-Host "These image assets are intentionally deployed separately from the frontend application bundle."
Write-Host "Ensure the bucket policy allows public read for '$Prefix/*' if the map should load without signed URLs."
