Param(
    [string]$BucketName = "community-profile-app-cluster-pics",
    [string]$Region = "us-east-1",
    [string]$SourceDir = $(Join-Path $PSScriptRoot "deployed\cursor_v2_map_data\photo_previews"),
    [string]$Prefix = "cluster-pics/priority-previews"
)

Write-Host "Bucket     :" $BucketName
Write-Host "Region     :" $Region
Write-Host "SourceDir  :" $SourceDir
Write-Host "S3 Prefix  :" $Prefix

if (!(Test-Path $SourceDir)) {
    Write-Error "Source directory '$SourceDir' does not exist. Priority preview JPEGs should live under deployed\cursor_v2_map_data\photo_previews."
    exit 1
}

$fileCount = (Get-ChildItem -Path $SourceDir -File -Filter "*.jpg" -ErrorAction SilentlyContinue).Count
Write-Host "Found $fileCount preview JPEG(s) to sync."

Write-Host "Ensuring bucket '$BucketName' exists in region '$Region'..."

aws s3api head-bucket --bucket $BucketName 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Error "Bucket '$BucketName' not found. Create it first or run deploy-cluster-pics-to-s3.ps1 once."
    exit 1
}

Write-Host "Syncing files to s3://$BucketName/$Prefix ..."

aws s3 sync $SourceDir "s3://$BucketName/$Prefix" --region $Region

if ($LASTEXITCODE -ne 0) {
    Write-Error "aws s3 sync failed. Check that AWS CLI is installed and configured."
    exit $LASTEXITCODE
}

$publicBaseUrl = "https://$BucketName.s3.$Region.amazonaws.com/$Prefix"

Write-Host "Done."
Write-Host "Public base URL: $publicBaseUrl"
Write-Host ""
Write-Host "Ensure bucket policy allows public read on cluster-pics/* (run set-cluster-pics-bucket-policy.ps1 if needed)."
