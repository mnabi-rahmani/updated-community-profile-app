Param(
    [string]$BucketName = "",
    [string]$Region = "us-east-1",
    [string]$DataDir = $(Join-Path $PSScriptRoot "deployed\cursor_v2_map_data"),
    [string]$Prefix = "community-priorities/priority-previews",
    [string]$CacheControl = "public,max-age=31536000,immutable",
    [switch]$SkipCommunity,
    [switch]$SkipInfrastructure
)

$ErrorActionPreference = "Continue"

$communitySource = Join-Path $DataDir "photo_previews"
$infrastructureSource = Join-Path $DataDir "infrastructure_photo_previews"
$assetScript = Join-Path $PSScriptRoot "deploy-community-priorities-map-assets-to-s3.ps1"

if (!(Get-Command aws -ErrorAction SilentlyContinue)) {
    Write-Error "AWS CLI was not found. Install/configure AWS CLI before syncing map image assets."
    exit 1
}

if (!(Test-Path $assetScript)) {
    Write-Error "Missing asset deployment helper: $assetScript"
    exit 1
}

if ([string]::IsNullOrWhiteSpace($BucketName)) {
    $identity = aws sts get-caller-identity --region $Region --output json 2>$null | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or !$identity.Account) {
        Write-Error "Could not resolve AWS account ID. Run 'aws login --remote' and retry, or pass -BucketName explicitly."
        exit 1
    }
    $BucketName = "community-priorities-map-assets-$($identity.Account)-$Region"
}

Write-Host "Priority map image sync"
Write-Host "Bucket    :" $BucketName
Write-Host "Region    :" $Region
Write-Host "Prefix    :" $Prefix
Write-Host "DataDir   :" $DataDir

$uploadedSets = @()

if (-not $SkipCommunity) {
    if (!(Test-Path $communitySource)) {
        Write-Error "Community preview directory missing: $communitySource. Run 'npm run generate:data' in deployed/ first."
        exit 1
    }

    Write-Host ""
    Write-Host "Uploading community priority previews..."
    & powershell -NoProfile -ExecutionPolicy Bypass -File $assetScript `
        -BucketName $BucketName `
        -Region $Region `
        -SourceDir $communitySource `
        -Prefix $Prefix `
        -CacheControl $CacheControl `
        -DeleteExtraneous
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Community preview upload failed."
        exit $LASTEXITCODE
    }
    $uploadedSets += "community"
}

if (-not $SkipInfrastructure) {
    if (!(Test-Path $infrastructureSource)) {
        Write-Error "Infrastructure preview directory missing: $infrastructureSource. Run 'npm run generate:infrastructure' in deployed/ first."
        exit 1
    }

    Write-Host ""
    Write-Host "Uploading infrastructure priority previews..."
    & powershell -NoProfile -ExecutionPolicy Bypass -File $assetScript `
        -BucketName $BucketName `
        -Region $Region `
        -SourceDir $infrastructureSource `
        -Prefix $Prefix `
        -CacheControl $CacheControl
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Infrastructure preview upload failed."
        exit $LASTEXITCODE
    }
    $uploadedSets += "infrastructure"
}

if ($uploadedSets.Count -eq 0) {
    Write-Error "No image sets were uploaded. Remove -SkipCommunity and/or -SkipInfrastructure."
    exit 1
}

$publicBaseUrl = "https://$BucketName.s3.$Region.amazonaws.com/$Prefix/"

Write-Host ""
Write-Host "Done. Uploaded image sets: $($uploadedSets -join ', ')"
Write-Host "Public base URL: $publicBaseUrl"
Write-Host ""
Write-Host "Set this URL as priorityPhotoBaseUrl in the map config before deploying the frontend."
