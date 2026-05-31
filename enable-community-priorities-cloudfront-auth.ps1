Param(
    [string]$Region = "us-east-1",
    [string[]]$DistributionIds = @("E2XU4NXZP6AG5G", "E4O4SG7G34LLN"),
    [string]$FunctionName = "community-priorities-map-basic-auth",
    [string[]]$AllowedCredentials = @(
        "super_admin:Qd7^sH4&xV0*bJ3%",
        "clusters_admin:Gy5!zN9#pK2$wM8@"
    )
)

$ErrorActionPreference = "Continue"
$ProtectedDistributionDomain = "d113s7v6pd04w6.cloudfront.net"

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

function Write-Utf8NoBom($Path, $Content) {
    [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

if (!(Get-Command aws -ErrorAction SilentlyContinue)) {
    Fail "AWS CLI was not found. Install/configure AWS CLI before enabling authentication."
}

if (!$AllowedCredentials -or $AllowedCredentials.Count -eq 0) {
    Fail "At least one username:password credential is required."
}

$identity = Invoke-AwsJson sts get-caller-identity --region $Region
Write-Host "Enabling Community Priorities CloudFront authentication"
Write-Host "Account       :" $identity.Account
Write-Host "Function name :" $FunctionName
Write-Host "Distributions :" ($DistributionIds -join ", ")
Write-Host "Allowed users :" (($AllowedCredentials | ForEach-Object { ($_ -split ":", 2)[0] }) -join ", ")

$encodedCredentials = @()
foreach ($credential in $AllowedCredentials) {
    if ($credential -notmatch "^[^:]+:.+$") {
        Fail "Invalid credential '$credential'. Expected username:password."
    }
    $encodedCredentials += [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($credential))
}

$allowedLines = ($encodedCredentials | ForEach-Object { "  ""Basic $_"": true" }) -join ",`n"
$functionCode = @"
function handler(event) {
  var request = event.request;
  var authorization = request.headers.authorization && request.headers.authorization.value;
  var allowed = {
$allowedLines
  };

  if (authorization && allowed[authorization]) {
    return request;
  }

  return {
    statusCode: 401,
    statusDescription: "Unauthorized",
    headers: {
      "www-authenticate": { value: "Basic realm=\"Community Priorities Map\"" },
      "cache-control": { value: "no-store" },
      "content-type": { value: "text/plain; charset=utf-8" }
    },
    body: "Authentication required"
  };
}
"@

$functionPath = Join-Path ([System.IO.Path]::GetTempPath()) "$FunctionName.js"
Write-Utf8NoBom $functionPath $functionCode

$functionExists = $true
$functionDescription = & aws cloudfront describe-function --name $FunctionName --stage DEVELOPMENT --region $Region --output json 2>$null
if ($LASTEXITCODE -ne 0) {
    $functionExists = $false
}

if ($functionExists) {
    $description = $functionDescription | ConvertFrom-Json
    Write-Host "Updating CloudFront Function '$FunctionName'..."
    $updated = Invoke-AwsJson cloudfront update-function `
        --name $FunctionName `
        --if-match $description.ETag `
        --function-config "Comment=Community Priorities basic authentication,Runtime=cloudfront-js-2.0" `
        --function-code "fileb://$functionPath" `
        --region $Region
    $etag = $updated.ETag
} else {
    Write-Host "Creating CloudFront Function '$FunctionName'..."
    $created = Invoke-AwsJson cloudfront create-function `
        --name $FunctionName `
        --function-config "Comment=Community Priorities basic authentication,Runtime=cloudfront-js-2.0" `
        --function-code "fileb://$functionPath" `
        --region $Region
    $etag = $created.ETag
}

Write-Host "Publishing CloudFront Function '$FunctionName'..."
$published = Invoke-AwsJson cloudfront publish-function --name $FunctionName --if-match $etag --region $Region
$functionArn = $published.FunctionSummary.FunctionMetadata.FunctionARN
Write-Host "Published function ARN:" $functionArn

foreach ($distributionId in $DistributionIds) {
    Write-Host "Associating auth function with distribution '$distributionId'..."
    $response = Invoke-AwsJson cloudfront get-distribution-config --id $distributionId --region $Region
    $config = $response.DistributionConfig
    $etag = $response.ETag

    $distribution = Invoke-AwsJson cloudfront get-distribution --id $distributionId --region $Region
    if ($distribution.Distribution.DomainName -eq $ProtectedDistributionDomain) {
        Fail "Refusing to modify protected distribution '$ProtectedDistributionDomain'."
    }

    $existingItems = @()
    if ($config.DefaultCacheBehavior.FunctionAssociations -and $config.DefaultCacheBehavior.FunctionAssociations.Items) {
        $existingItems = @($config.DefaultCacheBehavior.FunctionAssociations.Items | Where-Object { $_.EventType -ne "viewer-request" })
    }

    $viewerRequestAssociation = [pscustomobject]@{
        EventType = "viewer-request"
        FunctionARN = $functionArn
    }
    $items = @($existingItems + $viewerRequestAssociation)

    $functionAssociations = [pscustomobject]@{
        Quantity = $items.Count
        Items = $items
    }

    if ($config.DefaultCacheBehavior.FunctionAssociations) {
        $config.DefaultCacheBehavior.FunctionAssociations = $functionAssociations
    } else {
        $config.DefaultCacheBehavior | Add-Member -NotePropertyName FunctionAssociations -NotePropertyValue $functionAssociations
    }

    $configPath = Join-Path ([System.IO.Path]::GetTempPath()) "$distributionId-auth-config.json"
    Write-Utf8NoBom $configPath ($config | ConvertTo-Json -Depth 50)

    Invoke-Aws cloudfront update-distribution `
        --id $distributionId `
        --if-match $etag `
        --distribution-config "file://$configPath" `
        --region $Region | Out-Null
}

Write-Host "Done. Authentication is enabled on the Community Priorities CloudFront distribution(s)."
