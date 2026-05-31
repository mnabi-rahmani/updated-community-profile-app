Param(
    [string]$Region = "us-east-1",
    [string]$AppBucketName = "",
    [string]$AssetBucketName = "",
    [string]$AssetPrefix = "community-priorities/priority-previews",
    [string]$TargetDir = $(Join-Path $PSScriptRoot "frontend\dist\community-priorities-map"),
    [string]$DistributionComment = "",
    [string]$AppCacheControl = "public,max-age=300",
    [string]$AssetCacheControl = "public,max-age=31536000,immutable"
)

$ErrorActionPreference = "Stop"

$ProtectedCloudFrontDomain = "d113s7v6pd04w6.cloudfront.net"
$ProtectedAssetBucketName = "community-profile-app-cluster-pics"

function Fail($Message) {
    Write-Error $Message
    exit 1
}

function Invoke-AwsJson {
    $json = & aws @args --output json
    if ($LASTEXITCODE -ne 0) {
        Fail "AWS command failed: aws $($args -join ' ')"
    }
    if ([string]::IsNullOrWhiteSpace($json)) {
        return $null
    }
    return $json | ConvertFrom-Json
}

function Invoke-Aws {
    & aws @args
    if ($LASTEXITCODE -ne 0) {
        Fail "AWS command failed: aws $($args -join ' ')"
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
    $policy | Set-Content -Path $policyPath -Encoding UTF8
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
    $DistributionComment = "community-priorities-map-isolated-$($identity.Account)-$Region"
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

Write-Host "Packaging Community Priorities frontend..."
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "sync-community-priorities-map.ps1")
if ($LASTEXITCODE -ne 0) {
    Fail "Packaging failed."
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
$configPath = Join-Path $TargetDir "src\config.js"
@"
window.COMMUNITY_PRIORITIES_CONFIG = {
  priorityPhotoBaseUrl: "$assetBaseUrl"
};
"@ | Set-Content -Path $configPath -Encoding UTF8

Ensure-Bucket $AppBucketName
Allow-Public-Read $AppBucketName "arn:aws:s3:::$AppBucketName/*"
Invoke-Aws @("s3", "website", "s3://$AppBucketName/", "--index-document", "index.html", "--error-document", "index.html")

Write-Host "Uploading Community Priorities app bundle..."
Invoke-Aws @(
    "s3", "sync", $TargetDir, "s3://$AppBucketName/",
    "--region", $Region,
    "--delete",
    "--cache-control", $AppCacheControl
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
            }
            CachedMethods = @{
                Quantity = 2
                Items = @("GET", "HEAD")
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
    $distributionConfig | ConvertTo-Json -Depth 20 | Set-Content -Path $distributionConfigPath -Encoding UTF8

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
