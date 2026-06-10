Param(
    [string]$Region = "us-east-1",
    [string]$AppBucketName = "",
    [string]$AssetBucketName = "",
    [string]$AssetPrefix = "community-priorities/priority-previews",
    [string]$TargetDir = $(Join-Path $PSScriptRoot "frontend\dist\community-priorities-map"),
    [string]$ClusterTargetDir = $(Join-Path $PSScriptRoot "frontend\dist\cluster-priorities-map"),
    [string]$DistributionComment = "",
    [string]$AppCacheControl = "public,max-age=300",
    [string]$AssetCacheControl = "public,max-age=31536000,immutable"
)

$ErrorActionPreference = "Continue"

$ProtectedCloudFrontDomain = "d113s7v6pd04w6.cloudfront.net"
$ProtectedAssetBucketName = "community-profile-app-cluster-pics"

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

function Ensure-Bucket($BucketName) {
    aws s3api head-bucket --bucket $BucketName 2>$null
    if ($LASTEXITCODE -eq 0) {
        return
    }

    Write-Host "Creating bucket '$BucketName'..."
    if ($Region -eq "us-east-1") {
        Invoke-Aws @("s3api", "create-bucket", "--bucket", $BucketName, "--region", $Region)
    } else {
        Invoke-Aws @("s3api", "create-bucket", "--bucket", $BucketName, "--region", $Region, "--create-bucket-configuration", "LocationConstraint=$Region")
    }
}

function Allow-Public-Read($BucketName, $ResourceArn) {
    Invoke-Aws @(
        "s3api", "put-public-access-block",
        "--bucket", $BucketName,
        "--public-access-block-configuration", "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false"
    )

    $policy = @{
        Version = "2012-10-17"
        Statement = @(
            @{
                Sid = "PublicReadForCommunityPriorities"
                Effect = "Allow"
                Principal = "*"
                Action = "s3:GetObject"
                Resource = $ResourceArn
            }
        )
    } | ConvertTo-Json -Depth 8

    $policyPath = Join-Path ([System.IO.Path]::GetTempPath()) "$BucketName-policy.json"
    [System.IO.File]::WriteAllText($policyPath, $policy, [System.Text.UTF8Encoding]::new($false))
    Invoke-Aws @("s3api", "put-bucket-policy", "--bucket", $BucketName, "--policy", "file://$policyPath")
}

function Get-IsolatedDistribution($Comment) {
    $distributions = Invoke-AwsJson @("cloudfront", "list-distributions")
    $items = @()
    if ($distributions.DistributionList.Items) {
        $items = @($distributions.DistributionList.Items)
    }

    foreach ($item in $items) {
        if ($item.Comment -eq $Comment) {
            if ($item.DomainName -eq $ProtectedCloudFrontDomain) {
                Fail "Refusing to use protected CloudFront distribution '$ProtectedCloudFrontDomain'."
            }
            return $item
        }
    }

    return $null
}

if (!(Get-Command aws -ErrorAction SilentlyContinue)) {
    Fail "AWS CLI was not found. Install/configure AWS CLI before deploying."
}

$identity = Invoke-AwsJson @("sts", "get-caller-identity", "--region", $Region)
if (!$identity.Account) {
    Fail "Could not resolve AWS account ID from AWS CLI credentials."
}

if ([string]::IsNullOrWhiteSpace($AppBucketName)) {
    $AppBucketName = "community-priorities-map-app-$($identity.Account)-$Region"
}

if ([string]::IsNullOrWhiteSpace($AssetBucketName)) {
    $AssetBucketName = "community-priorities-map-assets-$($identity.Account)-$Region"
}

if ([string]::IsNullOrWhiteSpace($DistributionComment)) {
    $DistributionComment = "community-priorities-map-isolated-v4-$($identity.Account)-$Region"
}

if ($AppBucketName -eq $ProtectedAssetBucketName -or $AssetBucketName -eq $ProtectedAssetBucketName) {
    Fail "Refusing to deploy to protected existing app bucket '$ProtectedAssetBucketName'."
}

Write-Host "Isolated Community Priorities deployment"
Write-Host "Account              :" $identity.Account
Write-Host "Region               :" $Region
Write-Host "App bucket           :" $AppBucketName
Write-Host "Asset bucket         :" $AssetBucketName
Write-Host "Asset prefix         :" $AssetPrefix
Write-Host "Distribution comment :" $DistributionComment
Write-Host "Protected URL        :" $ProtectedCloudFrontDomain

function Write-IsolatedMapConfig($ConfigPath, $Body) {
    [System.IO.File]::WriteAllText($ConfigPath, $Body, [System.Text.UTF8Encoding]::new($false))
}

Write-Host "Packaging Community Priorities frontend..."
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "sync-community-priorities-map.ps1")
if ($LASTEXITCODE -ne 0) {
    Fail "Community priorities packaging failed."
}

Write-Host "Packaging Cluster Priorities frontend..."
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "sync-cluster-priorities-map.ps1")
if ($LASTEXITCODE -ne 0) {
    Fail "Cluster priorities packaging failed."
}

Ensure-Bucket $AssetBucketName
Allow-Public-Read $AssetBucketName "arn:aws:s3:::$AssetBucketName/$AssetPrefix/*"

$assetDeployScript = Join-Path $PSScriptRoot "deploy-community-priorities-map-assets-to-s3.ps1"
& powershell -NoProfile -ExecutionPolicy Bypass -File $assetDeployScript `
    -BucketName $AssetBucketName `
    -Region $Region `
    -Prefix $AssetPrefix `
    -CacheControl $AssetCacheControl
if ($LASTEXITCODE -ne 0) {
    Fail "Asset deployment failed."
}

$assetBaseUrl = "https://$AssetBucketName.s3.$Region.amazonaws.com/$AssetPrefix/"
$authApiBaseUrl = "https://tfqmwiadc8.execute-api.us-east-1.amazonaws.com"

$communityConfigPath = Join-Path $TargetDir "src\config.js"
Write-IsolatedMapConfig $communityConfigPath @"
window.COMMUNITY_PRIORITIES_CONFIG = {
  mapId: "assets-community-priorities",
  navItems: [
    {
      id: "assets-community-priorities",
      label: "Assets and Community Priorities Old",
      href: "/"
    },
    {
      id: "cluster-priorities-only",
      label: "Cluster Priorities Only",
      href: "/cluster-priorities-map/map.htm"
    }
  ],
  priorityPhotoBaseUrl: "$assetBaseUrl",
  authApiBaseUrl: "$authApiBaseUrl",
  allowedAuthModules: ["clusters_map", "all"]
};
"@

$clusterConfigPath = Join-Path $ClusterTargetDir "src\config.js"
Write-IsolatedMapConfig $clusterConfigPath @"
window.COMMUNITY_PRIORITIES_CONFIG = {
  displayMode: "infrastructure",
  priorityCountLabel: "infrastructure priorities",
  databaseLayerLabel: "boundary layers",
  prioritiesGlobal: "INFRASTRUCTURE_PRIORITIES",
  filtersGlobal: "INFRASTRUCTURE_FILTERS",
  areaPhotosGlobal: "INFRASTRUCTURE_AREA_PHOTOS",
  areaPhotoRadiusMeters: 100,
  mapId: "cluster-priorities-only",
  includedLayerIds: ["boundary_cluster", "boundary_community"],
  navItems: [
    {
      id: "assets-community-priorities",
      label: "Assets and Community Priorities Old",
      href: "/"
    },
    {
      id: "cluster-priorities-only",
      label: "Cluster Priorities Only",
      href: "/cluster-priorities-map/map.htm"
    }
  ],
  priorityPhotoBaseUrl: "$assetBaseUrl",
  authApiBaseUrl: "$authApiBaseUrl",
  allowedAuthModules: ["clusters_map", "all"]
};
"@

Ensure-Bucket $AppBucketName
Allow-Public-Read $AppBucketName "arn:aws:s3:::$AppBucketName/*"
Invoke-Aws @("s3", "website", "s3://$AppBucketName/", "--index-document", "index.html", "--error-document", "index.html")

Write-Host "Uploading Community Priorities app bundle..."
Invoke-Aws @(
    "s3", "sync", $TargetDir, "s3://$AppBucketName/",
    "--region", $Region,
    "--delete",
    "--cache-control", $AppCacheControl,
    "--exclude", "cluster-priorities-map/*"
)

if (!(Test-Path $ClusterTargetDir)) {
    Fail "Cluster priorities bundle '$ClusterTargetDir' was not found."
}

Write-Host "Uploading Cluster Priorities app bundle..."
Invoke-Aws @(
    "s3", "sync", $ClusterTargetDir, "s3://$AppBucketName/cluster-priorities-map/",
    "--region", $Region,
    "--delete",
    "--cache-control", $AppCacheControl,
    "--exclude", "cursor_v2_map_data/infrastructure_photo_previews/*"
)

$distribution = Get-IsolatedDistribution $DistributionComment

if ($distribution) {
    Write-Host "Using existing isolated CloudFront distribution: $($distribution.Id) / $($distribution.DomainName)"
    Invoke-Aws @("cloudfront", "create-invalidation", "--distribution-id", $distribution.Id, "--paths", "/*")
    $domainName = $distribution.DomainName
} else {
    $originDomain = "$AppBucketName.s3-website-$Region.amazonaws.com"
    $distributionConfig = @{
        CallerReference = "community-priorities-map-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
        Comment = $DistributionComment
        Enabled = $true
        IsIPV6Enabled = $false
        DefaultRootObject = "index.html"
        Origins = @{
            Quantity = 1
            Items = @(
                @{
                    Id = "community-priorities-app-s3-website"
                    DomainName = $originDomain
                    CustomOriginConfig = @{
                        HTTPPort = 80
                        HTTPSPort = 443
                        OriginProtocolPolicy = "http-only"
                        OriginSslProtocols = @{
                            Quantity = 1
                            Items = @("TLSv1.2")
                        }
                    }
                }
            )
        }
        DefaultCacheBehavior = @{
            TargetOriginId = "community-priorities-app-s3-website"
            ViewerProtocolPolicy = "redirect-to-https"
            Compress = $true
            AllowedMethods = @{
                Quantity = 2
                Items = @("GET", "HEAD")
                CachedMethods = @{
                    Quantity = 2
                    Items = @("GET", "HEAD")
                }
            }
            ForwardedValues = @{
                QueryString = $false
                Cookies = @{
                    Forward = "none"
                }
            }
            MinTTL = 0
            DefaultTTL = 300
            MaxTTL = 86400
        }
        PriceClass = "PriceClass_100"
        ViewerCertificate = @{
            CloudFrontDefaultCertificate = $true
        }
    }

    $distributionConfigPath = Join-Path ([System.IO.Path]::GetTempPath()) "community-priorities-cloudfront-config.json"
    [System.IO.File]::WriteAllText(
        $distributionConfigPath,
        ($distributionConfig | ConvertTo-Json -Depth 20),
        [System.Text.UTF8Encoding]::new($false)
    )

    Write-Host "Creating separate CloudFront distribution..."
    $created = Invoke-AwsJson @("cloudfront", "create-distribution", "--distribution-config", "file://$distributionConfigPath")
    $domainName = $created.Distribution.DomainName
    Write-Host "Created CloudFront distribution: $($created.Distribution.Id)"
}

if ($domainName -eq $ProtectedCloudFrontDomain) {
    Fail "Deployment resolved to protected CloudFront URL '$ProtectedCloudFrontDomain'. Aborting."
}

Write-Host ""
Write-Host "Done. Community Priorities was deployed to separate AWS resources."
Write-Host "New URL: https://$domainName"
Write-Host "Asset base URL: $assetBaseUrl"
Write-Host "Existing CloudFront URL was not modified: https://$ProtectedCloudFrontDomain/clusters-mapping"
