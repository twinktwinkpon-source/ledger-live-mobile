<#
.SYNOPSIS
  FLEX PWA launcher - starts license server (:9000) + mobile PWA server (:8081)
  and prints the URL to open on the iPhone/Android device.

.DESCRIPTION
  1. Starts the license server (server/index.js) if not already running
  2. Starts the mobile PWA server (server/mobile-server.js) if not already running
  3. Prints LAN URLs to open in Safari (then "Share → Add to Home Screen")

.EXAMPLE
  .\start-pwa.ps1
#>

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

function Test-Port($port) {
  try {
    $conn = New-Object System.Net.Sockets.TcpClient
    $conn.Connect("127.0.0.1", $port)
    $conn.Close()
    return $true
  } catch {
    return $false
  }
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  FLEX PWA Launcher" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# --- Step 1: License server ---
Write-Host "[1/2] License server (:9000)..." -ForegroundColor Yellow
if (Test-Port 9000) {
  Write-Host "  Already running (OK)" -ForegroundColor Green
} else {
  Write-Host "  Starting license server..." -ForegroundColor DarkYellow
  $serverPath = Join-Path $PSScriptRoot "index.js"
  Start-Process -FilePath "node" -ArgumentList $serverPath -WorkingDirectory $root -WindowStyle Minimized
  Start-Sleep -Seconds 2
  if (Test-Port 9000) {
    Write-Host "  License server started (OK)" -ForegroundColor Green
  } else {
    Write-Host "  ERROR: License server failed to start!" -ForegroundColor Red
    exit 1
  }
}

# --- Step 2: Mobile PWA server ---
Write-Host "[2/2] Mobile PWA server (:8081)..." -ForegroundColor Yellow
if (Test-Port 8081) {
  Write-Host "  Already running (OK)" -ForegroundColor Green
} else {
  Write-Host "  Starting mobile PWA server..." -ForegroundColor DarkYellow
  $mobilePath = Join-Path $PSScriptRoot "mobile-server.js"
  Start-Process -FilePath "node" -ArgumentList $mobilePath -WorkingDirectory $root -WindowStyle Minimized
  Start-Sleep -Seconds 2
  if (Test-Port 8081) {
    Write-Host "  Mobile PWA server started (OK)" -ForegroundColor Green
  } else {
    Write-Host "  ERROR: Mobile PWA server failed to start!" -ForegroundColor Red
    exit 1
  }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
$ips = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -ExpandProperty IPAddress
Write-Host "  Open on your iPhone (Safari):" -ForegroundColor Yellow
foreach ($ip in $ips) {
  Write-Host "    http://$ip`:8081" -ForegroundColor Green
}
Write-Host ""
Write-Host "  Then: Share -> Add to Home Screen" -ForegroundColor DarkGray
Write-Host "========================================" -ForegroundColor Cyan
