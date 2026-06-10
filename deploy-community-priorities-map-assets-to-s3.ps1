Param(
    [string]$BucketName = "",
    [string]$Region = "us-east-1",
    [string]$SourceDir = $(Join-Path $PSScriptRoot "deployed\cursor_v2_map_data\photo_previews"),
    [string]$Prefix = "community-priorities/priority-previews",
    [string]$CacheControl = "public,max-age=31536000,immutable",
    [switch]$DeleteExtraneous
)

$ErrorActionPreference = "Continue"
$ProtectedBucketName = "community-profile-app-cluster-pics"

if (!(Get-Command aws -ErrorAction SilentlyContinue)) {
    Write-Error "AWS CLI was not found. Install/configure AWS CLI before deploying map image assets."
    exit 1
}

if ([string]::IsNullOrWhiteSpace($BucketName)) {
    $identity = aws sts get-caller-identity --region $Region --output json | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or !$identity.Account) {
        Write-Error "Could not resolve AWS account ID. Configure AWS CLI credentials or pass -BucketName explicitly."
        exit 1
    }
    $BucketName = "community-priorities-map-assets-$($identity.Account)-$Region"
}

if ($BucketName -eq $ProtectedBucketName) {
    Write-Error "Refusing to deploy to protected existing app bucket '$ProtectedBucketName'. Choose a separate Community Priorities bucket."
    exit 1
}

Write-Host "Community priorities map asset deployment"
Write-Host "Bucket       :" $BucketName
Write-Host "Region       :" $Region
Write-Host "SourceDir    :" $SourceDir
Write-Host "S3 Prefix    :" $Prefix
Write-Host "Cache-Control:" $CacheControl

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
    Write-Host "Bucket '$BucketName' was not found. Creating it..."
    if ($Region -eq "us-east-1") {
        aws s3api create-bucket --bucket $BucketName --region $Region | Out-Null
    } else {
        aws s3api create-bucket --bucket $BucketName --region $Region --create-bucket-configuration "LocationConstraint=$Region" | Out-Null
    }
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Could not create bucket '$BucketName'. Check AWS credentials and bucket-name availability."
        exit $LASTEXITCODE
    }
}

aws s3api put-public-access-block `
    --bucket $BucketName `
    --public-access-block-configuration "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false" | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Error "Could not update public access block settings for '$BucketName'."
    exit $LASTEXITCODE
}

$policy = @{
    Version = "2012-10-17"
    Statement = @(
        @{
            Sid = "PublicReadCommunityPrioritiesImages"
            Effect = "Allow"
            Principal = "*"
            Action = "s3:GetObject"
            Resource = "arn:aws:s3:::$BucketName/$Prefix/*"
        }
    )
} | ConvertTo-Json -Depth 8

$policyPath = Join-Path ([System.IO.Path]::GetTempPath()) "community-priorities-assets-policy-$BucketName.json"
[System.IO.File]::WriteAllText($policyPath, $policy, [System.Text.UTF8Encoding]::new($false))
aws s3api put-bucket-policy --bucket $BucketName --policy "file://$policyPath" | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Error "Could not apply public read policy for '$BucketName/$Prefix'."
    exit $LASTEXITCODE
}

$destination = "s3://$BucketName/$Prefix"
Write-Host "Syncing map image assets to $destination ..."

$syncArgs = @(
    "s3", "sync", $SourceDir, $destination,
    "--region", $Region,
    "--exclude", "*",
    "--include", "*.jpg",
    "--content-type", "image/jpeg",
    "--cache-control", $CacheControl
)
if ($DeleteExtraneous) {
    $syncArgs += "--delete"
}
aws @syncArgs

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
