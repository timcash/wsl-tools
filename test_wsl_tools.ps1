function Assert-True {
    param($Condition, $Message)
    if (-not $Condition) {
        Write-Host "[FAIL] $Message" -ForegroundColor Red
        $Global:TestFailed = $true
    }
    else {
        Write-Host "[PASS] $Message" -ForegroundColor Green
    }
}

$Global:TestFailed = $false
$RandomId = Get-Random -Minimum 1000 -Maximum 9999
$TestInstance = "wsl-tools-test-$RandomId"
$BaseTarball = Join-Path $HOME "WSL\_bases\alpine.tar.gz"

Write-Host "--- Running Secure WSL Tools Test Suite ---" -ForegroundColor Cyan
Write-Host "Test Instance Name: $TestInstance" -ForegroundColor Cyan

# Ensure base exists
if (-not (Test-Path $BaseTarball)) {
    .\wsl_tools.ps1 alpine fetch
}

# 1. Setup Wrapper Instance
Write-Host "`n[Setup] Creating initial test instance..." -ForegroundColor Yellow
.\wsl_tools.ps1 $TestInstance new $BaseTarball
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to create setup instance. Aborting tests."
    exit 1
}

# 2. Test Overwrite Protection (Existing Name)
Write-Host "`nTest 1: Overwrite Protection (Existing Name)" -ForegroundColor Yellow
$errorOutput = & .\wsl_tools.ps1 $TestInstance new $BaseTarball 2>&1 | Out-String
Assert-True ($errorOutput -match "already exists") "Should fail when instance name already exists"

# 3. Test Overwrite Protection (Existing Path)
Write-Host "`nTest 2: Overwrite Protection (Existing Path)" -ForegroundColor Yellow
$CollisionName = "wsl-test-collision-$RandomId"
$CollisionPath = Join-Path $HOME "WSL\$CollisionName"
New-Item -ItemType Directory -Path $CollisionPath | Out-Null

$errorOutput = & .\wsl_tools.ps1 $CollisionName new $BaseTarball 2>&1 | Out-String
Assert-True ($errorOutput -match "already exists") "Should fail when install path already exists"

# Cleanup collision path
Remove-Item $CollisionPath -Force -Recurse

# 4. Test Daemon/Stop Lifecycle
Write-Host "`nTest 3: Daemon/Stop Lifecycle" -ForegroundColor Yellow
& .\wsl_tools.ps1 $TestInstance daemon
$job = Get-Job -Name "WSL_Daemon_$TestInstance"
Assert-True ($null -ne $job) "PowerShell job should be created for daemon"

& .\wsl_tools.ps1 $TestInstance stop
$job = Get-Job -Name "WSL_Daemon_$TestInstance" -ErrorAction SilentlyContinue
Assert-True ($null -eq $job) "PowerShell job should be removed upon stop"

# 5. Cleanup
Write-Host "`n[Cleanup] Unregistering test instance..." -ForegroundColor Yellow
wsl.exe --unregister $TestInstance
Write-Host "Instance '$TestInstance' removed." -ForegroundColor Green

Write-Host "`n--- Test Suite Summary ---" -ForegroundColor Cyan
if ($Global:TestFailed) {
    Write-Host "Some tests FAILED." -ForegroundColor Red
    exit 1
}
else {
    Write-Host "All tests PASSED." -ForegroundColor Green
    exit 0
}
