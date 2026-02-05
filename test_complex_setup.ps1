$RandomId = Get-Random -Minimum 1000 -Maximum 9999
$TestInstance = "dialtone-test-$RandomId"
$BaseTarball = Join-Path $HOME "WSL\_bases\alpine.tar.gz"

Write-Host "--- Starting Secure Complex Integration Test (Alpine Minimal) ---" -ForegroundColor Cyan
Write-Host "Target Instance: $TestInstance" -ForegroundColor Cyan

# 0. Fetch initial base if not present
if (-not (Test-Path $BaseTarball)) {
    Write-Host "Alpine base not found. Fetching..." -ForegroundColor Yellow
    .\wsl_tools.ps1 alpine fetch
}

# 1. Listing before
Write-Host "`n1. Listing existing WSL instances:" -ForegroundColor Yellow
.\wsl_tools.ps1 _ list

# 2. Create new instance
Write-Host "`n2. Creating new instance '$TestInstance' from '$BaseTarball'..." -ForegroundColor Yellow
# Ensure cleanup if it already exists from a previous run (highly unlikely with random ID)
if (wsl.exe -l --quiet | Select-String -Pattern $TestInstance) {
    wsl.exe --unregister $TestInstance 2>$null
}
.\wsl_tools.ps1 $TestInstance new $BaseTarball

# 3. Listing after
Write-Host "`n3. Verifying new instance exists in list:" -ForegroundColor Yellow
$list = wsl.exe -l --quiet | Where-Object { $_ -replace "\0", "" -match "^\s*$TestInstance\b" }
if ($list) {
    Write-Host "[PASS] '$TestInstance' found in list." -ForegroundColor Green
}
else {
    Write-Host "[FAIL] '$TestInstance' NOT found in list." -ForegroundColor Red
    exit 1
}

# 4. Alpine User Setup
Write-Host "`n4. Setting up user 'user' with password 'dialtone1' (Alpine style)..." -ForegroundColor Yellow
# Using `n for line endings to avoid \r
$setupCommands = "apk update`n" +
"apk add git openssh-server bash`n" +
"adduser -D -s /bin/bash user`n" +
"echo 'user:dialtone1' | chpasswd`n" +
"/usr/bin/ssh-keygen -A`n"

# Pass via stdin and ensure no trailing \r
$setupCommands | wsl.exe -d $TestInstance -u root -- sh

Write-Host "[INFO] Setup commands sent to $TestInstance." -ForegroundColor Green

# 5. Wait a bit for WSL to settle
Start-Sleep -Seconds 2

# 6. Git clone onto home folder
Write-Host "`n6. Cloning dialtone repository into its home folder..." -ForegroundColor Yellow
wsl.exe -d $TestInstance -u user -- bash -c "cd ~ && git clone https://github.com/timcash/dialtone"

if ($LASTEXITCODE -eq 0) {
    Write-Host "[PASS] Repository cloned successfully." -ForegroundColor Green
}
else {
    Write-Host "[FAIL] Git clone failed." -ForegroundColor Red
    # Cleanup on failure too
    wsl.exe --unregister $TestInstance
    exit 1
}

# 7. Monitor (New Feature Test)
Write-Host "`n7. Testing Monitor Command..." -ForegroundColor Yellow
.\wsl_tools.ps1 $TestInstance monitor

# 8. Cleanup
Write-Host "`n8. Cleanup..." -ForegroundColor Yellow
wsl.exe --unregister $TestInstance
Write-Host "Instance '$TestInstance' unregistered." -ForegroundColor Green

Write-Host "`n--- Complex Integration Test Summary ---" -ForegroundColor Cyan
Write-Host "Test complete. Instance '$TestInstance' was created, verified, and cleaned up." -ForegroundColor Green
