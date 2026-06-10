Param(
    [string]$Region = "us-east-1",
    [string]$FrontendDir = $(Join-Path $PSScriptRoot "frontend\dist"),
    [string]$CloudFrontDomain = "d113s7v6pd04w6.cloudfront.net",
    [string]$BucketName = "",
    [string]$DistributionId = "",
    [string]$AssetBucketName = "",
    [string]$AssetPrefix = "community-priorities/priority-previews",
    [string]$AuthApiBaseUrl = "https://tfqmwiadc8.execute-api.us-east-1.amazonaws.com",
    [string]$CacheControl = "public,max-age=300",
    [switch]$ExcludeBundledInfrastructurePreviews
)

$ErrorActionPreference = "Continue"

function Fail($Message) {
    Write-Error $Message
    exit 1
}

function Normalize-AwsArgs($Arguments) {
    if ($Arguments.Count -eq 1 -and $Arguments[0] -is [array]) {
        return @($Arguments[0])
    }
    return @($Arguments)
}

function Invoke-AwsJson {
    $awsArgs = Normalize-AwsArgs $args
    $json = & aws @awsArgs --output json
    if ($LASTEXITCODE -ne 0) {
        Fail "AWS command failed: aws $($awsArgs -join ' ')"
    }
    if ([string]::IsNullOrWhiteSpace($json)) {
        return $null
    }
    return $json | ConvertFrom-Json
}

function Invoke-Aws {
    $awsArgs = Normalize-AwsArgs $args
    & aws @awsArgs
    if ($LASTEXITCODE -ne 0) {
        Fail "AWS command failed: aws $($awsArgs -join ' ')"
    }
}

function Get-DistributionByDomain($DomainName) {
    $marker = $null
    do {
        $args = @("cloudfront", "list-distributions", "--region", $Region)
        if ($marker) {
            $args += @("--marker", $marker)
        }
        $response = Invoke-AwsJson $args
        $items = @()
        if ($response.DistributionList.Items) {
            $items = @($response.DistributionList.Items)
        }
        foreach ($item in $items) {
            if ($item.DomainName -eq $DomainName) {
                return $item
            }
        }
        $marker = $response.DistributionList.NextMarker
    } while ($response.DistributionList.IsTruncated)
    return $null
}

function Resolve-S3BucketFromOrigin($OriginDomain) {
    if ($OriginDomain -match "^(.+)\.s3(?:-website)?(?:-[a-z0-9-]+)?\.amazonaws\.com$") {
        return $Matches[1]
    }
    Fail "Could not resolve S3 bucket from CloudFront origin '$OriginDomain'."
}

function Update-MapConfig($ConfigPath, $PhotoBaseUrl) {
    if (!(Test-Path $ConfigPath)) {
        Fail "Map config not found: $ConfigPath"
    }

    $content = [System.IO.File]::ReadAllText($ConfigPath)
    $escapedUrl = [Regex]::Escape($PhotoBaseUrl)
    if ($content -match 'priorityPhotoBaseUrl:\s*"[^"]*"') {
        $content = [Regex]::Replace($content, 'priorityPhotoBaseUrl:\s*"[^"]*"', "priorityPhotoBaseUrl: `"$PhotoBaseUrl`"")
    } else {
        Fail "Could not update priorityPhotoBaseUrl in $ConfigPath"
    }

    if ($content -notmatch 'authApiBaseUrl:\s*"') {
        $content = $content -replace '(priorityPhotoBaseUrl:\s*"[^"]*",)', "`$1`n  authApiBaseUrl: `"$AuthApiBaseUrl`","
    } else {
        $content = [Regex]::Replace($content, 'authApiBaseUrl:\s*"[^"]*"', "authApiBaseUrl: `"$AuthApiBaseUrl`"")
    }

    [System.IO.File]::WriteAllText($ConfigPath, $content, [System.Text.UTF8Encoding]::new($false))
}

if (!(Get-Command aws -ErrorAction SilentlyContinue)) {
    Fail "AWS CLI was not found. Install/configure AWS CLI before deploying."
}

if (!(Test-Path $FrontendDir)) {
    Fail "Frontend directory '$FrontendDir' does not exist."
}

$identity = Invoke-AwsJson @("sts", "get-caller-identity", "--region", $Region)
if (!$identity.Account) {
    Fail "Could not resolve AWS account ID. Run 'aws login --remote' and retry."
}

if ([string]::IsNullOrWhiteSpace($AssetBucketName)) {
    $AssetBucketName = "community-priorities-map-assets-$($identity.Account)-$Region"
}

$assetBaseUrl = "https://$AssetBucketName.s3.$Region.amazonaws.com/$AssetPrefix/"

Write-Host "Production frontend deployment"
Write-Host "Account              :" $identity.Account
Write-Host "Region               :" $Region
Write-Host "FrontendDir          :" $FrontendDir
Write-Host "CloudFront domain    :" $CloudFrontDomain
Write-Host "Asset base URL       :" $assetBaseUrl

$communityConfig = Join-Path $FrontendDir "community-priorities-map\src\config.js"
$clusterConfig = Join-Path $FrontendDir "cluster-priorities-map\src\config.js"

if (Test-Path $communityConfig) {
    Update-MapConfig $communityConfig $assetBaseUrl
}
if (Test-Path $clusterConfig) {
    Update-MapConfig $clusterConfig $assetBaseUrl
}

if ([string]::IsNullOrWhiteSpace($DistributionId) -or [string]::IsNullOrWhiteSpace($BucketName)) {
    $distribution = Get-DistributionByDomain $CloudFrontDomain
    if (!$distribution) {
        Fail "CloudFront distribution for '$CloudFrontDomain' was not found."
    }
    if ([string]::IsNullOrWhiteSpace($DistributionId)) {
        $DistributionId = $distribution.Id
    }
    if ([string]::IsNullOrWhiteSpace($BucketName)) {
        $originDomain = $distribution.Origins.Items[0].DomainName
        $BucketName = Resolve-S3BucketFromOrigin $originDomain
    }
}

Write-Host "S3 bucket            :" $BucketName
Write-Host "Distribution ID      :" $DistributionId
Write-Host "Uploading frontend bundle..."

$syncArgs = @(
    "s3", "sync", $FrontendDir, "s3://$BucketName/",
    "--region", $Region,
    "--delete",
    "--cache-control", $CacheControl
)

if ($ExcludeBundledInfrastructurePreviews) {
    $syncArgs += @(
        "--exclude", "cluster-priorities-map/cursor_v2_map_data/infrastructure_photo_previews/*"
    )
}

Invoke-Aws $syncArgs

Write-Host "Creating CloudFront invalidation..."
Invoke-Aws @("cloudfront", "create-invalidation", "--distribution-id", $DistributionId, "--paths", "/*")

Write-Host ""
Write-Host "Done. Frontend deployed to production."
Write-Host "App URL      : https://$CloudFrontDomain"
Write-Host "Community map: https://$CloudFrontDomain/community-priorities-map/map.htm"
Write-Host "Cluster map  : https://$CloudFrontDomain/cluster-priorities-map/map.htm"
Write-Host "Photo base   : $assetBaseUrl"
