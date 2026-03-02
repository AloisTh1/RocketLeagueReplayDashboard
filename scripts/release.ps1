param(
  [int]$Port = 8000
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = Resolve-Path "$PSScriptRoot\.."
$dist = Join-Path $root "dist"
$backendDist = Join-Path $dist "backend"
$frontendDist = Join-Path $dist "frontend"
$toolsDist = Join-Path $dist "tools"
$frontendBuildDir = Join-Path $root "frontend\dist"
$backendExeRoot = Join-Path $dist "rl-dashboard-api.exe"
$backendExePackaged = Join-Path $backendDist "rl-dashboard-api.exe"
$zipPath = Join-Path $dist "release-dist.zip"

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

function Add-DirectoryToZip {
  param(
    [Parameter(Mandatory = $true)]
    [System.IO.Compression.ZipArchive]$Zip,
    [Parameter(Mandatory = $true)]
    [string]$DirectoryPath,
    [Parameter(Mandatory = $true)]
    [string]$RootName
  )
  $files = Get-ChildItem -Path $DirectoryPath -Recurse -File
  foreach ($file in $files) {
    $relative = $file.FullName.Substring($DirectoryPath.Length).TrimStart('\', '/')
    $entryName = ($RootName + "/" + $relative) -replace '\\', '/'
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $Zip,
      $file.FullName,
      $entryName,
      [System.IO.Compression.CompressionLevel]::Optimal
    ) | Out-Null
  }
}

Write-Host "Preparing dist folder..."
New-Item -ItemType Directory -Force $dist | Out-Null
@(
  $backendDist,
  $frontendDist,
  $toolsDist,
  $zipPath,
  (Join-Path $dist "run-backend.cmd")
) | ForEach-Object {
  if (Test-Path $_) {
    Remove-Item $_ -Recurse -Force
  }
}

Write-Host "Building frontend..."
Push-Location (Join-Path $root "frontend")
Invoke-StrictCmd -Args @("npm", "ci", "--no-audit", "--no-fund")
Invoke-StrictCmd -Args @("npm", "run", "build:prod")
Pop-Location

Write-Host "Building backend exe..."
Push-Location $root
Invoke-Strict -Command "uv" -Args @("sync", "--extra", "build")
Invoke-Strict -Command "uv" -Args @("run", "pyinstaller", "--noconfirm", "--clean", "--onefile", "--name", "rl-dashboard-api", "backend\main.py")
Pop-Location

if (!(Test-Path (Join-Path $frontendBuildDir "index.html"))) {
  throw "Missing frontend build output: $frontendBuildDir\\index.html"
}
if (!(Test-Path $backendExeRoot)) {
  throw "Missing backend executable: $backendExeRoot"
}

Write-Host "Assembling runtime package..."
New-Item -ItemType Directory -Force $backendDist | Out-Null
New-Item -ItemType Directory -Force $frontendDist | Out-Null
New-Item -ItemType Directory -Force $toolsDist | Out-Null

Copy-Item $backendExeRoot $backendExePackaged -Force
Copy-Item (Join-Path $frontendBuildDir "*") $frontendDist -Recurse -Force

$boxcarsCandidates = @()
if ($env:BOXCARS_EXE) { $boxcarsCandidates += $env:BOXCARS_EXE }
$boxcarsCandidates += @(
  (Join-Path $root ".boxcars-src\target\release\examples\json.exe"),
  (Join-Path $root ".boxcars-src\target\release\examples\json"),
  (Join-Path $root "tools\boxcars.exe"),
  (Join-Path $root "tools\boxcars")
)
$boxcarsBundlePath = $null
foreach ($candidate in $boxcarsCandidates) {
  if (!(Test-Path $candidate)) { continue }
  if ([System.IO.Path]::GetExtension($candidate) -ieq ".exe") {
    $boxcarsBundlePath = ".\tools\boxcars.exe"
  } else {
    $boxcarsBundlePath = ".\tools\boxcars"
  }
  Copy-Item $candidate (Join-Path $dist ($boxcarsBundlePath -replace "^\.\\" ,"")) -Force
  break
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

Write-Host "Creating release-dist.zip..."
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  Add-DirectoryToZip -Zip $zip -DirectoryPath $backendDist -RootName "backend"
  Add-DirectoryToZip -Zip $zip -DirectoryPath $frontendDist -RootName "frontend"
  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
    $zip,
    (Join-Path $dist "run-backend.cmd"),
    "run-backend.cmd",
    [System.IO.Compression.CompressionLevel]::Optimal
  ) | Out-Null
  if (Test-Path (Join-Path $dist "tools")) {
    Add-DirectoryToZip -Zip $zip -DirectoryPath (Join-Path $dist "tools") -RootName "tools"
  }
} finally {
  $zip.Dispose()
}

if (!(Test-Path $zipPath)) {
  throw "Expected package missing: $zipPath"
}
$zipEntries = [System.IO.Compression.ZipFile]::OpenRead($zipPath).Entries | ForEach-Object { ($_.FullName -replace '\\','/') }
if (-not ($zipEntries | Where-Object { $_ -match '(^|/)backend/rl-dashboard-api\.exe$' })) {
  throw "release-dist.zip is missing backend/rl-dashboard-api.exe"
}

Write-Host "Release artifacts created in $dist"
