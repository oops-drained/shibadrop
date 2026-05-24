# Deploy shibadrop to Dokploy via API
# Usage:
#   $env:DOKPLOY_URL = "https://dokploy.your-server.com"
#   $env:DOKPLOY_API_KEY = "your-api-key"
#   .\scripts\deploy-dokploy.ps1

param(
  [string]$DokployUrl = $env:DOKPLOY_URL,
  [string]$ApiKey = $env:DOKPLOY_API_KEY,
  [string]$Domain = "shibarewards.com",
  [string]$GithubOwner = "oops-drained",
  [string]$GithubRepo = "shibadrop",
  [string]$Branch = "master",
  [string]$GithubId = $env:DOKPLOY_GITHUB_ID
)

$ErrorActionPreference = "Stop"

if (-not $DokployUrl -or -not $ApiKey) {
  Write-Host "Missing DOKPLOY_URL or DOKPLOY_API_KEY." -ForegroundColor Red
  Write-Host "Create an API key in Dokploy: Settings -> Profile -> API/CLI"
  exit 1
}

$DokployUrl = $DokployUrl.TrimEnd("/")
$api = "$DokployUrl/api"

function Invoke-Dokploy {
  param([string]$Endpoint, [object]$Body = $null, [string]$Method = "POST")
  $headers = @{
    "x-api-key" = $ApiKey
    "Content-Type" = "application/json"
  }
  $uri = "$api/$Endpoint"
  if ($Body) {
    $json = $Body | ConvertTo-Json -Depth 10 -Compress
    return Invoke-RestMethod -Uri $uri -Method $Method -Headers $headers -Body $json
  }
  return Invoke-RestMethod -Uri $uri -Method $Method -Headers $headers
}

Write-Host "==> Dokploy: $DokployUrl" -ForegroundColor Cyan

# 1. Project
$projectName = "ShibArmy Rewards"
$projects = Invoke-Dokploy -Endpoint "project.all" -Method "GET"
$project = $projects | Where-Object { $_.name -eq $projectName } | Select-Object -First 1
if (-not $project) {
  Write-Host "Creating project: $projectName"
  $project = Invoke-Dokploy -Endpoint "project.create" -Body @{ name = $projectName; description = "shibarewards.com" }
}
$projectId = $project.projectId
if (-not $projectId) { $projectId = $project.id }
Write-Host "Project ID: $projectId"

# 2. Environment (production)
$envs = Invoke-Dokploy -Endpoint "environment.byProjectId?projectId=$projectId" -Method "GET"
$environment = $envs | Where-Object { $_.name -match "production|prod" } | Select-Object -First 1
if (-not $environment) {
  $environment = $envs | Select-Object -First 1
}
if (-not $environment) {
  Write-Host "Creating production environment"
  $environment = Invoke-Dokploy -Endpoint "environment.create" -Body @{
    name = "production"
    projectId = $projectId
    description = "Production"
  }
}
$environmentId = $environment.environmentId
if (-not $environmentId) { $environmentId = $environment.id }
Write-Host "Environment ID: $environmentId"

# 3. Application
$appName = "shibadrop"
$app = $null
try {
  $search = Invoke-Dokploy -Endpoint "project.one?projectId=$projectId" -Method "GET"
  if ($search.applications) {
    $app = $search.applications | Where-Object { $_.appName -eq $appName -or $_.name -eq $appName } | Select-Object -First 1
  }
} catch { }

if (-not $app) {
  Write-Host "Creating application: $appName"
  $app = Invoke-Dokploy -Endpoint "application.create" -Body @{
    name = "ShibArmy Loyalty Airdrop"
    appName = $appName
    description = "https://$Domain"
    environmentId = $environmentId
  }
}
$applicationId = $app.applicationId
if (-not $applicationId) { $applicationId = $app.id }
Write-Host "Application ID: $applicationId"

# 4. Build type: Dockerfile
Write-Host "Configuring Dockerfile build"
Invoke-Dokploy -Endpoint "application.saveBuildType" -Body @{
  applicationId = $applicationId
  buildType = "dockerfile"
  dockerfile = "Dockerfile"
  dockerContextPath = "."
} | Out-Null

# 5. GitHub source
if (-not $GithubId) {
  Write-Host "DOKPLOY_GITHUB_ID not set — configure GitHub in Dokploy UI first, then re-run." -ForegroundColor Yellow
  Write-Host "Repository: $GithubOwner/$GithubRepo branch $Branch"
} else {
  Write-Host "Linking GitHub: $GithubOwner/$GithubRepo"
  Invoke-Dokploy -Endpoint "application.saveGithubProvider" -Body @{
    applicationId = $applicationId
    owner = $GithubOwner
    repository = $GithubRepo
    branch = $Branch
    buildPath = "/"
    githubId = $GithubId
    triggerType = "push"
  } | Out-Null
}

# 6. Domain
$existingDomains = Invoke-Dokploy -Endpoint "domain.byApplicationId?applicationId=$applicationId" -Method "GET"
$hasDomain = $existingDomains | Where-Object { $_.host -eq $Domain }
if (-not $hasDomain) {
  Write-Host "Adding domain: $Domain (HTTPS)"
  Invoke-Dokploy -Endpoint "domain.create" -Body @{
    host = $Domain
    path = "/"
    port = 80
    https = $true
    certificateType = "letsencrypt"
    applicationId = $applicationId
  } | Out-Null
} else {
  Write-Host "Domain already configured: $Domain"
}

# 7. Deploy
Write-Host "Triggering deployment..."
Invoke-Dokploy -Endpoint "application.deploy" -Body @{
  applicationId = $applicationId
  title = "Deploy shibarewards.com"
  description = "Automated deploy from deploy-dokploy.ps1"
} | Out-Null

Write-Host ""
Write-Host "Deployment queued successfully." -ForegroundColor Green
Write-Host "App: $DokployUrl/dashboard/project/$projectId/environment/$environmentId/services/application/$applicationId"
Write-Host "Site: https://$Domain (after DNS points to your Dokploy server and deploy finishes)"
