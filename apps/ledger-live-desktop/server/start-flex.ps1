<#
.SYNOPSIS
  FLEX_DEMO Launcher - starts license server + Ledger Live Desktop

.DESCRIPTION
  1. Starts the license server (if not already running)
  2. Sets FLEX_DEMO=true environment variable
  3. Runs Ledger Live Desktop in dev mode via pnpm
#>

$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\..\..\.."

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  FLEX_DEMO Launcher" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# --- Step 1: Check/start license server ---
Write-Host "[1/3] Checking license server..." -ForegroundColor Yellow
$serverRunning = $false
try {
  $r = Invoke-RestMethod -Uri "http://localhost:9000/health" -Method GET -TimeoutSec 3
  $serverRunning = $true
  Write-Host "  Server already running (OK)" -ForegroundColor Green
} catch {
  Write-Host "  Server not running, starting..." -ForegroundColor DarkYellow
  $serverPath = Join-Path $root "apps\ledger-live-desktop\server\index.js"
  Start-Process -FilePath "node" -ArgumentList $serverPath -WindowStyle Minimized
  Start-Sleep -Seconds 2
  try {
    $r = Invoke-RestMethod -Uri "http://localhost:9000/health" -Method GET -TimeoutSec 5
    $serverRunning = $true
    Write-Host "  Server started (OK)" -ForegroundColor Green
  } catch {
    Write-Host "  ERROR: Server failed to start!" -ForegroundColor Red
    exit 1
  }
}

# --- Step 2: Set FLEX_DEMO + Nx workarounds ---
Write-Host ""
Write-Host "[2/3] Setting environment variables..." -ForegroundColor Yellow
$env:FLEX_DEMO = "true"
# Workaround for Nx 22.x plugin worker crash on Windows
$env:NX_DAEMON = "false"
$env:NX_NO_PLUGINS = "true"
# Do not let an inherited Electron development flag force electron.exe to run
# as plain Node.js (electron-is-dev detects this and aborts the main process).
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Write-Host "  FLEX_DEMO=$env:FLEX_DEMO" -ForegroundColor Green
Write-Host "  NX_DAEMON=$env:NX_DAEMON" -ForegroundColor Green
Write-Host "  NX_NO_PLUGINS=$env:NX_NO_PLUGINS" -ForegroundColor Green

# --- Step 3: Run Ledger Live Desktop ---
Write-Host ""
Write-Host "[3/3] Starting Ledger Live Desktop..." -ForegroundColor Yellow
Write-Host "  Bypassing Nx (running start script directly)" -ForegroundColor DarkGray
Write-Host ""

$lldPath = Join-Path $root "apps\ledger-live-desktop"
Set-Location $lldPath

# Run the start script directly, bypassing Nx to avoid plugin worker crashes.
$env:NODE_ENV = "development"
$env:TS_NODE_PROJECT = "tools/rspack/tsconfig.json"
# Note: cross-env is NOT used because the env vars are already set above.
# Using cross-env would lose the NX_NO_PLUGINS and FLEX_DEMO vars set earlier.
Write-Host "  Starting rspack dev server + Electron..." -ForegroundColor Green
& npx node --require ts-node/register ./tools/main-rspack.ts
