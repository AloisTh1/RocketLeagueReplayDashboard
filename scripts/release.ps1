param(
  [int]$Port = 8000
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\.."
$dist = Join-Path $root "dist"
$backendDist = Join-Path $dist "backend"
$frontendDist = Join-Path $dist "frontend"
$toolsDist = Join-Path $dist "tools"

function Invoke-Strict {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Command,
    [string[]]$Args = @()
  )
  & $Command @Args
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed ($LASTEXITCODE): $Command $($Args -join ' ')"
  }
}

function Invoke-StrictCmd {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Args
  )
  & cmd.exe /c @Args
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed ($LASTEXITCODE): cmd /c $($Args -join ' ')"
  }
}

function Invoke-WithRetry {
  param(
    [Parameter(Mandatory = $true)]
    [scriptblock]$Action,
    [int]$Attempts = 3,
    [int]$DelaySeconds = 2
  )
  $lastError = $null
  for ($i = 1; $i -le $Attempts; $i++) {
    try {
      & $Action
      return
    } catch {
      $lastError = $_
      if ($i -lt $Attempts) {
        Write-Host "Attempt $i/$Attempts failed. Retrying in $DelaySeconds sec..."
        Start-Sleep -Seconds $DelaySeconds
      }
    }
  }
  throw $lastError
}

New-Item -ItemType Directory -Force $dist | Out-Null
@(
  (Join-Path $dist "backend"),
  (Join-Path $dist "frontend"),
  (Join-Path $dist "tools"),
  (Join-Path $dist "release-dist.zip"),
  (Join-Path $dist "release-dist.tar.gz"),
  (Join-Path $dist "run-backend.cmd"),
  (Join-Path $dist "run-backend.sh")
) | ForEach-Object {
  if (Test-Path $_) {
    Remove-Item $_ -Recurse -Force
  }
}

Write-Host "Building frontend..."
Push-Location (Join-Path $root "frontend")
$env:npm_config_cache = Join-Path $root ".npm-cache"
$frontendDistIndex = Join-Path $root "frontend\dist\index.html"
$canBuildFrontend = $true
$npmCiWorked = $true
try {
  Invoke-WithRetry -Action { Invoke-StrictCmd -Args @("npm", "ci", "--no-audit", "--no-fund") } -Attempts 3 -DelaySeconds 3
} catch {
  $npmCiWorked = $false
  Write-Warning "npm ci failed (often due to locked node_modules on Windows). Falling back to npm install."
}
if (-not $npmCiWorked) {
  try {
    Invoke-WithRetry -Action { Invoke-StrictCmd -Args @("npm", "install", "--no-audit", "--no-fund") } -Attempts 3 -DelaySeconds 3
  } catch {
    if (Test-Path $frontendDistIndex) {
      $canBuildFrontend = $false
      Write-Warning "npm install failed. Reusing existing frontend/dist."
    } else {
      throw
    }
  }
}
if ($canBuildFrontend) {
  try {
    Invoke-StrictCmd -Args @("npm", "run", "build:prod")
  } catch {
    if (Test-Path $frontendDistIndex) {
      Write-Warning "Frontend build failed (often EPERM/esbuild spawn on local Windows). Reusing existing frontend/dist."
    } else {
      throw
    }
  }
}
Pop-Location

Write-Host "Building backend exe..."
Push-Location $root
$env:UV_CACHE_DIR = Join-Path $root ".uv-cache"
$backendExe = Join-Path $root "dist\rl-dashboard-api.exe"
$canBuildBackend = $true
try {
  Invoke-Strict -Command "uv" -Args @("sync", "--extra", "build")
  Invoke-Strict -Command "uv" -Args @("run", "pyinstaller", "--noconfirm", "--clean", "--onefile", "--name", "rl-dashboard-api", "backend\main.py")
} catch {
  if (Test-Path $backendExe) {
    $canBuildBackend = $false
    Write-Warning "Backend build failed. Reusing existing dist\\rl-dashboard-api.exe."
  } else {
    throw
  }
}
Pop-Location

New-Item -ItemType Directory -Force $backendDist | Out-Null
New-Item -ItemType Directory -Force $frontendDist | Out-Null
New-Item -ItemType Directory -Force $toolsDist | Out-Null

Copy-Item (Join-Path $root "dist\rl-dashboard-api.exe") (Join-Path $backendDist "rl-dashboard-api.exe") -Force
Copy-Item (Join-Path $root "frontend\dist\*") $frontendDist -Recurse -Force
if (!(Test-Path (Join-Path $backendDist "rl-dashboard-api.exe"))) {
  throw "Missing backend executable in package folder: $backendDist\\rl-dashboard-api.exe"
}

$boxcarsCandidates = @()
if ($env:BOXCARS_EXE) { $boxcarsCandidates += $env:BOXCARS_EXE }
$boxcarsCandidates += @(
  (Join-Path $root ".boxcars-src\target\release\examples\json.exe"),
  (Join-Path $root ".boxcars-src\target\release\examples\json"),
  (Join-Path $root "tools\boxcars.exe"),
  (Join-Path $root "tools\boxcars")
)
$boxcarsSrc = $null
foreach ($candidate in $boxcarsCandidates) {
  if (Test-Path $candidate) {
    $boxcarsSrc = $candidate
    break
  }
}
$boxcarsBundlePath = $null
if ($boxcarsSrc) {
  if ([System.IO.Path]::GetExtension($boxcarsSrc) -ieq ".exe") {
    $boxcarsBundlePath = ".\tools\boxcars.exe"
  } else {
    $boxcarsBundlePath = ".\tools\boxcars"
  }
  Copy-Item $boxcarsSrc (Join-Path $dist ($boxcarsBundlePath -replace "^\.\\" ,"")) -Force
}

if ($boxcarsBundlePath) {
@"
set PORT=$Port
set BOXCARS_EXE=$boxcarsBundlePath
.\backend\rl-dashboard-api.exe
"@ | Set-Content (Join-Path $dist "run-backend.cmd")
} else {
@"
set PORT=$Port
.\backend\rl-dashboard-api.exe
"@ | Set-Content (Join-Path $dist "run-backend.cmd")
}

$archiveItems = @(
  (Join-Path $dist "backend"),
  (Join-Path $dist "frontend"),
  (Join-Path $dist "run-backend.cmd")
)
if ($boxcarsBundlePath) {
  $archiveItems += (Join-Path $dist "tools")
}
$archiveItems = $archiveItems | Where-Object { Test-Path $_ }
$zipPath = Join-Path $dist "release-dist.zip"
if (Test-Path $zipPath) {
  Remove-Item $zipPath -Force
}
if ($archiveItems.Count -gt 0) {
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($item in $archiveItems) {
      if (Test-Path $item -PathType Container) {
        $rootName = [System.IO.Path]::GetFileName($item)
        $files = Get-ChildItem -Path $item -Recurse -File
        foreach ($file in $files) {
          $relative = $file.FullName.Substring($item.Length).TrimStart('\','/')
          $entryName = ($rootName + "/" + $relative) -replace '\\','/'
          [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
      } else {
        $entryName = [System.IO.Path]::GetFileName($item)
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $item, $entryName, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
      }
    }
  } finally {
    $zip.Dispose()
  }
}
if (!(Test-Path $zipPath)) {
  throw "Expected package missing: $zipPath"
}
$zipEntries = [System.IO.Compression.ZipFile]::OpenRead($zipPath).Entries | ForEach-Object { ($_.FullName -replace '\\','/') }
if (-not ($zipEntries | Where-Object { $_ -match '(^|/)backend/rl-dashboard-api\.exe$' })) {
  throw "release-dist.zip is missing backend/rl-dashboard-api.exe"
}

Write-Host "Release artifacts created in $dist"
