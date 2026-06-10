Param(
    [string]$Region = "us-east-1",
    [string]$AppUrl = "https://d113s7v6pd04w6.cloudfront.net",
    [string]$IsolatedMapUrl = "https://d1b6znwb7yuvt4.cloudfront.net",
    [string]$ApiBaseUrl = "https://tfqmwiadc8.execute-api.us-east-1.amazonaws.com",
    [string]$AssetPrefix = "community-priorities/priority-previews",
    [string]$SampleImageName = ""
)

$ErrorActionPreference = "Continue"

function Pass($Message) {
    Write-Host "[PASS] $Message" -ForegroundColor Green
}

function Fail-Check($Message) {
    Write-Host "[FAIL] $Message" -ForegroundColor Red
    $script:FailedChecks += 1
}

function Warn-Check($Message) {
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

$FailedChecks = 0

Write-Host "Online deployment verification"
Write-Host "App URL      : $AppUrl"
Write-Host "Isolated map : $IsolatedMapUrl"
Write-Host "API URL      : $ApiBaseUrl"
Write-Host ""

try {
    $isolatedResponse = Invoke-WebRequest -Uri $IsolatedMapUrl -UseBasicParsing -TimeoutSec 30
    if ($isolatedResponse.StatusCode -eq 200 -and $isolatedResponse.Content -match "Assets and Community Priorities|leaflet") {
        Pass "Isolated Community Priorities map is reachable ($IsolatedMapUrl)"
    } else {
        Fail-Check "Isolated map returned unexpected content from $IsolatedMapUrl"
    }
} catch {
    Fail-Check "Isolated Community Priorities map is not reachable: $($_.Exception.Message)"
}

try {
    $isolatedConfig = Invoke-WebRequest -Uri "$IsolatedMapUrl/src/config.js" -UseBasicParsing -TimeoutSec 30
    if ($isolatedConfig.Content -match 'priorityPhotoBaseUrl:\s*"(https?://[^"]+)"') {
        Pass "Isolated map config exposes S3 photo base URL"
    } else {
        Warn-Check "Isolated map config is missing priorityPhotoBaseUrl"
    }
} catch {
    Warn-Check "Could not fetch isolated map config"
}


try {
    $appResponse = Invoke-WebRequest -Uri $AppUrl -UseBasicParsing -TimeoutSec 30
    if ($appResponse.StatusCode -eq 200 -and $appResponse.Content -match "Community Profile App") {
        Pass "Main frontend is reachable ($AppUrl)"
    } else {
        Fail-Check "Main frontend returned unexpected content from $AppUrl"
    }
} catch {
    Fail-Check "Main frontend is not reachable: $($_.Exception.Message)"
}

try {
    $apiResponse = Invoke-WebRequest -Uri "$ApiBaseUrl/auth/verify" -Method GET -UseBasicParsing -TimeoutSec 30
    if ($apiResponse.StatusCode -eq 200 -and $apiResponse.Content -match '"success"\s*:\s*true') {
        Pass "Dev API auth endpoint is reachable"
    } else {
        Fail-Check "Dev API auth endpoint returned unexpected content"
    }
} catch {
    Fail-Check "Dev API is not reachable: $($_.Exception.Message)"
}

$assetBucket = ""
if (Get-Command aws -ErrorAction SilentlyContinue) {
    $identity = aws sts get-caller-identity --region $Region --output json 2>$null | ConvertFrom-Json
    if ($LASTEXITCODE -eq 0 -and $identity.Account) {
        $assetBucket = "community-priorities-map-assets-$($identity.Account)-$Region"
    }
}
if ([string]::IsNullOrWhiteSpace($assetBucket)) {
    $assetBucket = "community-priorities-map-assets-974389254535-$Region"
}

if ([string]::IsNullOrWhiteSpace($SampleImageName)) {
    $previewDir = Join-Path $PSScriptRoot "deployed\cursor_v2_map_data\photo_previews"
    if (Test-Path $previewDir) {
        $SampleImageName = (Get-ChildItem $previewDir -Filter "*.jpg" | Select-Object -First 1 -ExpandProperty Name)
    }
}

if ($assetBucket -and $SampleImageName) {
    $imageUrl = "https://$assetBucket.s3.$Region.amazonaws.com/$AssetPrefix/$SampleImageName"
    try {
        $imageResponse = Invoke-WebRequest -Uri $imageUrl -Method Head -UseBasicParsing -TimeoutSec 30
        if ($imageResponse.StatusCode -eq 200) {
            Pass "Sample priority preview image is publicly accessible ($SampleImageName)"
        } else {
            Fail-Check "Sample image returned status $($imageResponse.StatusCode) at $imageUrl"
        }
    } catch {
        Fail-Check "Sample priority preview image is not accessible at $imageUrl"
    }
} else {
    Warn-Check "Skipped image check (AWS auth or local preview files unavailable)"
}

$mapPaths = @(
    "/community-priorities-map/map.htm",
    "/cluster-priorities-map/map.htm"
)

foreach ($mapPath in $mapPaths) {
    $mapUrl = "$AppUrl$mapPath"
    try {
        $mapResponse = Invoke-WebRequest -Uri $mapUrl -UseBasicParsing -TimeoutSec 30
        if ($mapResponse.StatusCode -eq 200 -and $mapResponse.Content -match "leaflet|Community Priorities|INFRASTRUCTURE_PRIORITIES|authScreen") {
            Pass "Map route is deployed ($mapPath)"
        } elseif ($mapResponse.StatusCode -eq 200 -and $mapResponse.Content -match "Sign In") {
            Warn-Check "Map route '$mapPath' is being rewritten to the React SPA login shell. Deploy map.htm and static assets to the production bucket, or open the route without SPA fallback."
        } else {
            Fail-Check "Map route '$mapPath' returned unexpected content"
        }
    } catch {
        Fail-Check "Map route '$mapPath' is not reachable: $($_.Exception.Message)"
    }
}

foreach ($configPath in @("/community-priorities-map/src/config.js", "/cluster-priorities-map/src/config.js")) {
    $configUrl = "$AppUrl$configPath"
    try {
        $configResponse = Invoke-WebRequest -Uri $configUrl -UseBasicParsing -TimeoutSec 30
        if ($configResponse.StatusCode -eq 200 -and $configResponse.Content -match "priorityPhotoBaseUrl") {
            if ($configResponse.Content -match 'priorityPhotoBaseUrl:\s*"(https?://[^"]+)"') {
                Pass "Map config exposes S3 photo base URL ($configPath)"
            } else {
                Warn-Check "Map config is deployed but priorityPhotoBaseUrl is empty ($configPath)"
            }
        } else {
            Warn-Check "Map config not directly reachable ($configPath)"
        }
    } catch {
        Warn-Check "Could not fetch map config ($configPath)"
    }
}

Write-Host ""
if ($FailedChecks -eq 0) {
    Write-Host "Verification completed successfully."
    exit 0
}

Write-Host "Verification completed with $FailedChecks failure(s)."
exit 1
