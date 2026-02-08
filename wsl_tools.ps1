param (
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet("new", "daemon", "stop", "list", "fetch", "monitor", "list-json", "monitor-json", "dashboard", "ssh", "delete", "unregister")]
    [string]$Command,

    [Parameter(Mandatory = $false, Position = 1)]
    [string]$InstanceName,

    [Parameter(Mandatory = $false, Position = 2)]
    [string]$BaseDistro = "Ubuntu"
)

# Force UTF-8 for clean output to the dashboard
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# --- Validation for Instance-Specific Commands ---
$InstanceSpecificCommands = @("new", "daemon", "stop", "monitor", "monitor-json", "ssh", "delete", "unregister")
if ($InstanceSpecificCommands -contains $Command -and -not $InstanceName) {
    Write-Error "Command '$Command' requires an instance name. Usage: .\wsl_tools.ps1 $Command <instance_name>"
    exit 1
}

# --- Configuration ---
$WSL_DIR = Join-Path $HOME "WSL"
$BASES_DIR = Join-Path $WSL_DIR "_bases"

if (-not (Test-Path $WSL_DIR)) {
    New-Item -ItemType Directory -Path $WSL_DIR | Out-Null
}
if (-not (Test-Path $BASES_DIR)) {
    New-Item -ItemType Directory -Path $BASES_DIR | Out-Null
}

# --- Logging Configuration ---
$LOG_FILE = Join-Path $PSScriptRoot "src\powershell.log"

function Write-WslLog {
    param($Message, $Level = "INFO", $Quiet = $false)
    if ($Quiet) { return }
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logLine = "[$timestamp] [$Level] $Message"
    
    # Still write to file but ignore errors if locked
    try {
        $logDir = [System.IO.Path]::GetDirectoryName($LOG_FILE)
        if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
        $logLine | Out-File -FilePath $LOG_FILE -Append -Encoding utf8 -ErrorAction SilentlyContinue
    } catch {}
}

function Invoke-WslCommand {
    param($ArgsList)
    $cmdString = "wsl.exe " + ($ArgsList -join " ")
    Write-WslLog "Executing: $cmdString" "DEBUG" -Quiet $true # Suppress noise
    $output = & wsl.exe @ArgsList
    return $output
}

# Suppress Command Entry log for high-frequency polling
$QuietCommands = @("list-json", "monitor-json")
Write-WslLog "Command Entry: $Command $($InstanceName -join ' ')" -Quiet ($QuietCommands -contains $Command)

# --- Helper Functions ---
function Test-WSLInstanceExists {
    param($Name, $Quiet = $false)
    if (-not $Quiet) { Write-WslLog "Checking existence for '$Name'..." }
    $lines = wsl.exe -l --quiet
    # wsl -l --quiet output is often UTF-16LE with null bytes.
    foreach ($line in $lines) {
        $clean = $line -replace "\x00", "" -replace "^\s+", "" -replace "\s+$", ""
        if ($clean -eq $Name) { 
            if (-not $Quiet) { Write-WslLog "Instance '$Name' exists." }
            return $true 
        }
    }
    if (-not $Quiet) { Write-WslLog "Instance '$Name' not found." "DEBUG" }
    return $false
}

function Export-WSLDistro {
    param($Distro, $OutputPath)
    Write-Host "Exporting $Distro to $OutputPath..." -ForegroundColor Gray
    wsl.exe --export $Distro $OutputPath
    if ($LASTEXITCODE -ne 0) { throw "wsl --export failed with code $LASTEXITCODE" }
}

function Import-WSLDistro {
    param($Name, $InstallPath, $SourcePath)
    Write-Host "Importing $Name from $SourcePath into $InstallPath..." -ForegroundColor Gray
    if (-not (Test-Path $InstallPath)) {
        New-Item -ItemType Directory -Path $InstallPath | Out-Null
    }
    wsl.exe --import $Name $InstallPath $SourcePath
    if ($LASTEXITCODE -ne 0) { throw "wsl --import failed with code $LASTEXITCODE" }
}

# --- Command Functions ---

function Save-WSLBase {
    param($Type = "alpine")
    
    $url = "https://dl-cdn.alpinelinux.org/alpine/v3.21/releases/x86_64/alpine-minirootfs-3.21.2-x86_64.tar.gz"
    $dest = Join-Path $BASES_DIR "alpine.tar.gz"
    
    Write-Host "Fetching minimal $Type rootfs from $url..." -ForegroundColor Cyan
    Invoke-WebRequest -Uri $url -OutFile $dest
    Write-Host "Downloaded to $dest" -ForegroundColor Green
}

function Measure-WSLInstance {
    param($Name, $AsJson = $false)
    
    if (-not $AsJson) { Write-Host "Monitoring resources for '$Name'..." -ForegroundColor Cyan }
    
    if (-not (Test-WSLInstanceExists -Name $Name -Quiet $AsJson)) {
        if (-not $AsJson) { Write-Error "Instance '$Name' not found." }
        return
    }
    
    $statusLine = wsl.exe -l -v | Select-String -Pattern "^\s*\*?\s*$Name\b"
    if ($statusLine -notmatch "Running") {
        if (-not $AsJson) { Write-Warning "Instance '$Name' is not running. Cannot monitor." }
        return
    }

    # Internal helper to get metrics
    $MemVal = "Unknown"
    $DiskVal = "Unknown"

    try {
        $Mem = wsl.exe -d $Name -- free -m 2>$null | Select-String "Mem:"
        if ($Mem) {
            $MemParts = $Mem.ToString().Split(" ", [System.StringSplitOptions]::RemoveEmptyEntries)
            if ($MemParts.Count -ge 3) {
                $MemVal = "$($MemParts[2])MB / $($MemParts[1])MB"
            }
        }
        
        $Disk = wsl.exe -d $Name -- df -h / 2>$null | Select-String "/$"
        if ($Disk) {
            $DiskParts = $Disk.ToString().Split(" ", [System.StringSplitOptions]::RemoveEmptyEntries)
            if ($DiskParts.Count -ge 3) {
                $DiskVal = "$($DiskParts[2]) / $($DiskParts[1])"
            }
        }
    } catch {
        Write-WslLog "Error getting metrics for ${Name}: $_" "ERROR"
    }

    if ($AsJson) {
        $stats = @{
            InstanceName = $Name
            Memory       = $MemVal
            Disk         = $DiskVal
            Timestamp    = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        }
        $stats | ConvertTo-Json -Compress
    }
    else {
        $uptime = wsl.exe -d $Name -- uptime
        Write-Host "`n[UPTIME & LOAD]" -ForegroundColor Yellow
        $uptime

        Write-Host "`n[MEMORY]" -ForegroundColor Yellow
        wsl.exe -d $Name -- free -m

        Write-Host "`n[DISK USAGE]" -ForegroundColor Yellow
        wsl.exe -d $Name -- df -h /

        Write-Host "`n[NETWORK]" -ForegroundColor Yellow
        wsl.exe -d $Name -- ip -s link
    }
}

function Get-WSLInstances {
    param($AsJson = $false)
    Write-WslLog "Listing instances (JSON: $AsJson)..." -Quiet $AsJson
    if ($AsJson) {
        # Fix encoding: wsl output is UTF-16LE, PowerShell might read it with nulls if piped
        # We explicitly rely on string replacement to clean up the null bytes commonly seen
        $lines = wsl.exe -l -v
        
        $parsed = $lines | Select-Object -Skip 1 | Where-Object { $_ -match "\w" } | ForEach-Object {
            # Clean up null bytes and whitespace
            $line = $_ -replace "\x00", "" -replace "^\s*\*\s*", "" -replace "^\s+", ""
            $parts = $line -split "\s+"
            if ($parts.Count -ge 3) {
                [PSCustomObject]@{
                    Name    = $parts[0]
                    State   = $parts[1]
                    Version = $parts[2]
                }
            }
        }
        $json = $parsed | ConvertTo-Json -Compress
        Write-WslLog "Instances found: $($parsed.Count)" "DEBUG"
        return $json
    }
    else {
        wsl.exe -l -v
    }
}

function New-WSLInstance {
    param($Name, $Base)
    
    Write-WslLog "Request: New instance '$Name' from '$Base'"
    Write-Host "Creating new WSL instance '$Name' from '$Base'..." -ForegroundColor Cyan
    
    # Auto-resolve 'alpine' shortcut to downloaded rootfs
    if ($Base -eq "alpine" -and -not (Test-Path $Base)) {
        $PossibleAlpine = Join-Path $BASES_DIR "alpine.tar.gz"
        if (Test-Path $PossibleAlpine) {
            Write-WslLog "Auto-resolved 'alpine' to $PossibleAlpine" "DEBUG"
            $Base = $PossibleAlpine
        }
    }
    
    # 1. Validation
    if (Test-WSLInstanceExists -Name $Name) {
        Write-WslLog "Aborting: '$Name' already exists." "ERROR"
        Write-Error "WSL instance with name '$Name' already exists. Aborting."
        exit 1
    }

    $InstallPath = Join-Path $WSL_DIR $Name
    if (Test-Path $InstallPath) {
        Write-WslLog "Aborting: Install path '$InstallPath' already exists." "ERROR"
        Write-Error "Install path '$InstallPath' already exists. Aborting."
        return
    }

    # 2. Deployment
    if (Test-Path $Base) {
        # Import from local tarball
        try {
            Write-WslLog "Action: Importing $Name from $Base"
            Import-WSLDistro -Name $Name -InstallPath $InstallPath -SourcePath $Base
            Write-WslLog "Success: Instance '$Name' created."
            Write-Host "Instance '$Name' created successfully from $Base." -ForegroundColor Green
        }
        catch {
            Write-WslLog "Failure: $_" "ERROR"
            Write-Error "Failed to import WSL instance: $_"
            exit 1
        }
    }
    else {
        # Clone existing distro
        $TempTar = [System.IO.Path]::GetTempFileName() + ".tar"
        try {
            Write-WslLog "Action: Exporting $Base to temp"
            Export-WSLDistro -Distro $Base -OutputPath $TempTar
            Write-WslLog "Action: Importing $Name from temp"
            Import-WSLDistro -Name $Name -InstallPath $InstallPath -SourcePath $TempTar
            Write-WslLog "Success: Instance '$Name' created via cloning."
            Write-Host "Instance '$Name' created successfully." -ForegroundColor Green
        }
        catch {
            Write-WslLog "Failure: $_" "ERROR"
            Write-Error "Failed to create WSL instance '$Name' from '$Base': $_"
            # Cleanup on failure if the directory was created
            if (Test-Path $InstallPath) { Remove-Item $InstallPath -Recurse -Force -ErrorAction SilentlyContinue }
            exit 1
        }
        finally {
            if (Test-Path $TempTar) { Remove-Item $TempTar -Force }
        }
    }
}

function Start-WSLDaemon {
    param($Name)
    
    Write-WslLog "Request: Start daemon for '$Name'"
    Write-Host "Starting daemon for WSL instance '$Name'..." -ForegroundColor Cyan
    
    # Check if already running
    if (Test-WSLInstanceExists -Name $Name) {
        $statusLine = wsl.exe -l -v | Select-String -Pattern "^\s*\*?\s*$Name\b"
        if ($statusLine -match "Running") {
            Write-Host "Instance '$Name' is already running." -ForegroundColor Yellow
            Write-WslLog "'$Name' is already running. Skipping daemon start." "DEBUG"
            return
        }
    }

    # Start using Start-Process to ensure it's detached and persistent
    Write-WslLog "Action: Detaching background process (wsl -d $Name -- sleep infinity)"
    Start-Process -FilePath "wsl.exe" -ArgumentList "-d", $Name, "--", "sleep", "infinity" -NoNewWindow
    
    # Give it a moment to actually show as 'Running' in wsl -l -v
    Start-Sleep -Seconds 2
    
    $statusLine = wsl.exe -l -v | Select-String -Pattern "^\s*\*?\s*$Name\b"
    if ($statusLine -match "Running") {
        Write-Host "Daemon started and verified for '$Name'." -ForegroundColor Green
        Write-WslLog "Status: Verified 'Running' for '$Name'."
    } else {
        Write-WslLog "Warning: Daemon process started but instance '$Name' still shows as $($statusLine -split '\s+')[2]" "WARN"
    }
}

function Stop-WSLInstance {
    param($Name)
    
    Write-WslLog "Request: Stop instance '$Name'"
    Write-Host "Stopping WSL instance '$Name'..." -ForegroundColor Cyan
    
    # 1. Terminate the instance itself
    wsl.exe --terminate $Name
    
    # 2. Find and kill any detached background processes (Start-Process wsl ...)
    # We look for wsl.exe processes that have the instance name in their command line
    $procs = Get-CimInstance Win32_Process -Filter "Name = 'wsl.exe'" | Where-Object { $_.CommandLine -match "-d\s+$Name\b" }
    foreach ($p in $procs) {
        Write-WslLog "Action: Killing background wsl process $($p.ProcessId) for $Name" "DEBUG"
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }

    # Give it a moment to fully unregister from the running list
    Start-Sleep -Seconds 2
    
    Write-Host "Instance '$Name' stopped and background jobs cleared." -ForegroundColor Green
    Write-WslLog "Status: Instance '$Name' stopped."
}

# --- Main Switch ---
switch ($Command) {
    "new" { New-WSLInstance -Name $InstanceName -Base $BaseDistro }
    "daemon" { Start-WSLDaemon -Name $InstanceName }
    "stop" { Stop-WSLInstance -Name $InstanceName }
    "list" { Get-WSLInstances -AsJson $false }
    "list-json" { Get-WSLInstances -AsJson $true }
    "fetch" { Save-WSLBase -Type $BaseDistro }
    "monitor" { Measure-WSLInstance -Name $InstanceName -AsJson $false }
    "monitor-json" { Measure-WSLInstance -Name $InstanceName -AsJson $true }
    "dashboard" {
        $WebDir = Join-Path $PSScriptRoot "src"
        Write-Host "--- Dashboard Diagnostics (v2) ---" -ForegroundColor Gray
        
        # 1. Check for running Bun processes
        $BunProcs = Get-Process -Name bun -ErrorAction SilentlyContinue
        if ($BunProcs) {
            Write-Host "[INFO] Detected $($BunProcs.Count) running Bun process(es):" -ForegroundColor Yellow
            $BunProcs | Select-Object Id, ProcessName, @{N = 'Path'; E = { $_.MainModule.FileName } } | Format-Table -AutoSize
        }
        else {
            Write-Host "[OK] No conflicting Bun processes found." -ForegroundColor Green
        }

        # 2. Check for port conflicts (Defaulting to check 3000 as common dashboard port)
        # Note: server.ts uses port 0 (dynamic), but user might be concerned about specific ports if they customize
        $Conflict = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | Where-Object { $_.State -eq 'Listen' }
        if ($Conflict) {
            Write-Warning "Port 3000 is already in use by PID $($Conflict.OwningProcess)."
        }

        Write-Host "`nStarting WSL Dashboard from $WebDir..." -ForegroundColor Cyan
        Set-Location $WebDir
        
        # Start bun in the background so we can monitor the port file
        $job = Start-Job -ScriptBlock {
            param($dir)
            Set-Location $dir
            bun run dev
        } -ArgumentList $WebDir

        Write-Host "Waiting for dashboard to initialize..." -ForegroundColor Gray
        $portFile = Join-Path $WebDir ".port"
        if (Test-Path $portFile) { Remove-Item $portFile }

        $timeout = (Get-Date).AddSeconds(15)
        while (-not (Test-Path $portFile) -and (Get-Date) -lt $timeout) {
            Start-Sleep -Milliseconds 500
        }

        if (Test-Path $portFile) {
            $port = Get-Content $portFile
            Write-Host "`n🚀 Dashboard is LIVE: http://localhost:$port" -ForegroundColor Green
            Write-Host "Press Ctrl+C to stop (terminates background job)." -ForegroundColor Gray
            
            # Follow the job output
            Receive-Job -Job $job -Wait
        } else {
            Write-Error "Dashboard failed to start or write .port file within 15 seconds."
            Stop-Job $job
        }
    }
    "ssh" {
        wsl.exe -d $InstanceName
    }
    "unregister" {
        Write-Host "Unregistering WSL instance '$InstanceName'..." -ForegroundColor Cyan
        wsl.exe --unregister $InstanceName
    }
    "delete" {
        Write-Host "Unregistering WSL instance '$InstanceName'..." -ForegroundColor Cyan
        wsl.exe --unregister $InstanceName
    }
}
