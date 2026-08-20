<#
.SYNOPSIS
  License Manager CLI for FLEX_DEMO License Server

.DESCRIPTION
  PowerShell script to manage license keys on the FLEX_DEMO license server.
  Works on Windows where `curl` is aliased to `Invoke-WebRequest`.

.EXAMPLE
  # Generate a new license key
  .\manager.ps1 generate

.EXAMPLE
  # Activate a key with a specific HWID
  .\manager.ps1 activate -Key "FLEX-XXXX-XXXX-XXXX" -Hwid "test-hwid-12345"

.EXAMPLE
  # Validate a key
  .\manager.ps1 validate -Key "FLEX-XXXX-XXXX-XXXX" -Hwid "test-hwid-12345"

.EXAMPLE
  # Get balances for a key
  .\manager.ps1 balances -Key "FLEX-XXXX-XXXX-XXXX" -Hwid "test-hwid-12345"

.EXAMPLE
  # List all keys
  .\manager.ps1 list

.EXAMPLE
  # Update balances for a key
  .\manager.ps1 update -Key "FLEX-XXXX-XXXX-XXXX" -Bitcoin "20000000000" -Ton "10000000000000000000"

.EXAMPLE
  # Check server health
  .\manager.ps1 health
#>

param(
  [Parameter(Position = 0)]
  [ValidateSet("generate", "activate", "validate", "balances", "list", "update", "deactivate", "health")]
  [string]$Action = "health",

  [string]$Key,
  [string]$Hwid,
  [string]$Bitcoin,
  [string]$Ethereum,
  [string]$Solana,
  [string]$Ton,
  [string]$Ripple,
  [string]$Cardano,
  [string]$Dogecoin,
  [string]$Polkadot,
  [string]$Tron,
  [string]$Polygon,

  [string]$Server = "http://localhost:9000",
  [string]$AdminSecret = $env:FLEX_ADMIN_SECRET
)
if (-not $AdminSecret) { $AdminSecret = "flex-dev-2024" }

$ProgressPreference = "SilentlyContinue"

function Send-Request {
  param([string]$Endpoint, [hashtable]$Body)
  $json = $Body | ConvertTo-Json -Compress
  try {
    $response = Invoke-RestMethod -Uri "$Server$Endpoint" -Method POST -ContentType "application/json" -Body $json
    return $response
  } catch {
    # Extract error message from the HTTP response body
    $errorMsg = $null

    # PowerShell 5.1: response is in $_.Exception.Response
    if ($_.Exception.Response) {
      try {
        $resp = $_.Exception.Response
        $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        $reader.Close()
        if ($responseBody) {
          $errorJson = $responseBody | ConvertFrom-Json
          if ($errorJson.error) {
            $errorMsg = $errorJson.error
          }
        }
      } catch {
        # Fall through to status code
      }
    }

    # Fallback: use ErrorDetails
    if (-not $errorMsg -and $_.ErrorDetails -and $_.ErrorDetails.Message) {
      try {
        $errorJson = $_.ErrorDetails.Message | ConvertFrom-Json
        if ($errorJson.error) {
          $errorMsg = $errorJson.error
        }
      } catch {
        $errorMsg = $_.ErrorDetails.Message
      }
    }

    # Final fallback: HTTP status code
    if (-not $errorMsg) {
      $statusCode = $_.Exception.Response.StatusCode.value__
      if ($statusCode -eq 404) {
        $errorMsg = "Key not found on server"
      } elseif ($statusCode -eq 403) {
        $errorMsg = "Access denied (wrong key, HWID mismatch, or admin secret required)"
      } elseif ($statusCode -eq 400) {
        $errorMsg = "Bad request (missing key or hwid)"
      } else {
        $errorMsg = "HTTP $statusCode"
      }
    }

    Write-Host ""
    Write-Host "ERROR: $errorMsg" -ForegroundColor Red
    exit 1
  }
}

switch ($Action) {
  "health" {
    try {
      $r = Invoke-RestMethod -Uri "$Server/health" -Method GET
      Write-Host "Server: " -NoNewline
      Write-Host "OK" -ForegroundColor Green
      Write-Host "Timestamp: $($r.timestamp)"
    } catch {
      Write-Host "Server: " -NoNewline
      Write-Host "OFFLINE" -ForegroundColor Red
      Write-Host "Make sure the server is running: node apps/ledger-live-desktop/server/index.js"
    }
  }

  "generate" {
    $body = @{ adminSecret = $AdminSecret }
    $r = Send-Request -Endpoint "/generate-key" -Body $body
    Write-Host "Generated key: " -NoNewline
    Write-Host $r.key -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Balances:" -ForegroundColor Yellow
    $r.balances.PSObject.Properties | ForEach-Object {
      Write-Host "  $($_.Name): $($_.Value)"
    }
    Write-Host ""
    Write-Host "Activate with:" -ForegroundColor DarkGray
    Write-Host "  .\manager.ps1 activate -Key '$($r.key)' -Hwid '<HWID>'" -ForegroundColor DarkGray
  }

  "activate" {
    if (-not $Key -or -not $Hwid) {
      Write-Host "Usage: .\manager.ps1 activate -Key <KEY> -Hwid <HWID>" -ForegroundColor Red
      exit 1
    }
    $body = @{ key = $Key; hwid = $Hwid }
    $r = Send-Request -Endpoint "/activate" -Body $body
    if ($r.success) {
      Write-Host "Activation: " -NoNewline
      Write-Host "SUCCESS" -ForegroundColor Green
      Write-Host ""
      Write-Host "Balances:" -ForegroundColor Yellow
      $r.balances.PSObject.Properties | ForEach-Object {
        Write-Host "  $($_.Name): $($_.Value)"
      }
    }
  }

  "validate" {
    if (-not $Key -or -not $Hwid) {
      Write-Host "Usage: .\manager.ps1 validate -Key <KEY> -Hwid <HWID>" -ForegroundColor Red
      exit 1
    }
    $body = @{ key = $Key; hwid = $Hwid }
    $r = Send-Request -Endpoint "/validate" -Body $body
    if ($r.valid) {
      Write-Host "Validation: " -NoNewline
      Write-Host "VALID" -ForegroundColor Green
    } else {
      Write-Host "Validation: " -NoNewline
      Write-Host "INVALID" -ForegroundColor Red
    }
  }

  "balances" {
    if (-not $Key -or -not $Hwid) {
      Write-Host "Usage: .\manager.ps1 balances -Key <KEY> -Hwid <HWID>" -ForegroundColor Red
      exit 1
    }
    $body = @{ key = $Key; hwid = $Hwid }
    $r = Send-Request -Endpoint "/balances" -Body $body
    Write-Host "Balances:" -ForegroundColor Yellow
    $r.balances.PSObject.Properties | ForEach-Object {
      Write-Host "  $($_.Name): $($_.Value)"
    }
    Write-Host ""
    Write-Host "Session token: $($r.sessionToken)" -ForegroundColor DarkGray
  }

  "list" {
    $body = @{ adminSecret = $AdminSecret }
    $r = Send-Request -Endpoint "/list-keys" -Body $body
    Write-Host "Keys ($($r.keys.Count)):" -ForegroundColor Yellow
    Write-Host ""
    foreach ($k in $r.keys) {
      $status = if ($k.active) { "ACTIVE" } else { "DISABLED" }
      $statusColor = if ($k.active) { "Green" } else { "Red" }
      Write-Host "  $($k.key)" -NoNewline
      Write-Host " [$status]" -ForegroundColor $statusColor -NoNewline
      if ($k.hwid) {
        Write-Host " HWID: $($k.hwid)..." -NoNewline
      } else {
        Write-Host " (not activated)" -ForegroundColor DarkGray -NoNewline
      }
      if ($k.activatedAt) {
        Write-Host " Activated: $($k.activatedAt)"
      } else {
        Write-Host ""
      }
    }
  }

  "update" {
    if (-not $Key) {
      Write-Host "Usage: .\manager.ps1 update -Key <KEY> [-Bitcoin <val>] [-Ton <val>] ..." -ForegroundColor Red
      exit 1
    }
    $balances = @{}
    if ($Bitcoin) { $balances.bitcoin = $Bitcoin }
    if ($Ethereum) { $balances.ethereum = $Ethereum }
    if ($Solana) { $balances.solana = $Solana }
    if ($Ton) { $balances.ton = $Ton }
    if ($Ripple) { $balances.ripple = $Ripple }
    if ($Cardano) { $balances.cardano = $Cardano }
    if ($Dogecoin) { $balances.dogecoin = $Dogecoin }
    if ($Polkadot) { $balances.polkadot = $Polkadot }
    if ($Tron) { $balances.tron = $Tron }
    if ($Polygon) { $balances.polygon = $Polygon }

    if ($balances.Count -eq 0) {
      Write-Host "No balances specified. Use -Bitcoin, -Ton, etc." -ForegroundColor Red
      exit 1
    }

    $body = @{ key = $Key; adminSecret = $AdminSecret; balances = $balances }
    $r = Send-Request -Endpoint "/update-balances" -Body $body
    if ($r.success) {
      Write-Host "Update: " -NoNewline
      Write-Host "SUCCESS" -ForegroundColor Green
      Write-Host ""
      Write-Host "New balances:" -ForegroundColor Yellow
      $r.balances.PSObject.Properties | ForEach-Object {
        Write-Host "  $($_.Name): $($_.Value)"
      }
    }
  }

  "deactivate" {
    if (-not $Key) {
      Write-Host "Usage: .\manager.ps1 deactivate -Key <KEY>" -ForegroundColor Red
      exit 1
    }
    $body = @{ key = $Key; adminSecret = $AdminSecret }
    $r = Send-Request -Endpoint "/deactivate-key" -Body $body
    if ($r.success) {
      Write-Host "Deactivation: " -NoNewline
      Write-Host "SUCCESS" -ForegroundColor Green
      Write-Host "Key $Key has been disabled." -ForegroundColor Yellow
    }
  }
}
