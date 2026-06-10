Param(
    [string]$Region = "us-east-1",
    [switch]$SkipGenerate,
    [switch]$SkipImageSync,
    [switch]$SkipFrontendDeploy,
    [switch]$RegenerateData,
    [switch]$ExcludeBundledInfrastructurePreviews
)

$ErrorActionPreference = "Continue"

function Fail($Message) {
    Write-Error $Message
    exit 1
}

function Run-Step($Title, $ScriptBlock) {
    Write-Host ""
    Write-Host "== $Title =="
    & $ScriptBlock
    if ($LASTEXITCODE -ne 0) {
        Fail "$Title failed."
    }
}

if (!(Get-Command aws -ErrorAction SilentlyContinue)) {
    Fail "AWS CLI was not found. Install/configure AWS CLI before deploying."
}

$identityJson = aws sts get-caller-identity --region $Region --output json 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "AWS credentials are missing or expired."
    Write-Host "Run this in a terminal, complete browser sign-in, then rerun deploy-all-to-aws.ps1:"
    Write-Host "  aws configure set region $Region"
    Write-Host "  aws login --remote"
    Fail "AWS authentication required."
}
$identity = $identityJson | ConvertFrom-Json

Write-Host "Full deployment for Community Profile App"
Write-Host "AWS account: $($identity.Account)"
Write-Host "Region     : $Region"

if ($RegenerateData -or -not $SkipGenerate) {
    Run-Step "Generate community priorities data" {
        Push-Location (Join-Path $PSScriptRoot "deployed")
        try {
            if (!(Test-Path "node_modules")) {
                npm install
                if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
            }
            if ($RegenerateData -or -not $SkipGenerate) {
                npm run generate:data
                if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
                npm run generate:infrastructure
                if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
            }
        } finally {
            Pop-Location
        }
    }
}

Run-Step "Package community priorities map" {
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "sync-community-priorities-map.ps1")
}

Run-Step "Package cluster priorities map" {
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "sync-cluster-priorities-map.ps1")
}

if (-not $SkipImageSync) {
    Run-Step "Sync priority map images to S3" {
        & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "sync-priority-map-images-to-s3.ps1") -Region $Region
    }
}

if (-not $SkipFrontendDeploy) {
    Run-Step "Deploy frontend to production CloudFront" {
        $frontendScript = Join-Path $PSScriptRoot "deploy-frontend-to-aws.ps1"
        if ($ExcludeBundledInfrastructurePreviews) {
            & powershell -NoProfile -ExecutionPolicy Bypass -File $frontendScript -Region $Region -ExcludeBundledInfrastructurePreviews
        } else {
            & powershell -NoProfile -ExecutionPolicy Bypass -File $frontendScript -Region $Region
        }
    }

    Run-Step "Deploy isolated Community Priorities map (d1b6znwb7yuvt4)" {
        $isolatedComment = "community-priorities-map-isolated-v4-$($identity.Account)-$Region"
        & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "deploy-community-priorities-map-isolated-to-aws.ps1") `
            -Region $Region `
            -DistributionComment $isolatedComment
    }
}

Run-Step "Verify deployment online" {
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "test-deployment-online.ps1") -Region $Region
}

Write-Host ""
Write-Host "All deployment steps completed."
