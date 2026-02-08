param (
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet("new", "daemon", "stop", "list", "fetch", "monitor", "list-json", "monitor-json", "dashboard", "ssh", "delete", "unregister")]
    [string]$Command,

    [Parameter(Mandatory = $false, Position = 1)]
    [string]$InstanceName,

    [Parameter(Mandatory = $false, Position = 2)]
    [string]$BaseDistro = "Ubuntu"
)

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
    param($Message, $Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logLine = "[$timestamp] [$Level] $Message"
    $logLine | Out-File -FilePath $LOG_FILE -Append -Encoding utf8
}

Write-WslLog "Command Entry: $Command $($InstanceName -join ' ')"

# --- Helper Functions ---
function Test-WSLInstanceExists {
    param($Name)
    Write-WslLog "Checking existence for '$Name'..."
    $lines = wsl.exe -l --quiet
    # wsl -l --quiet output is often UTF-16LE with null bytes.
    # We clean it up and check for exact match.
    foreach ($line in $lines) {
        $clean = $line -replace "\x00", "" -replace "^\s+", "" -replace "\s+$", ""
        if ($clean -eq $Name) { 
            Write-WslLog "Instance '$Name' exists."
            return $true 
        }
    }
    Write-WslLog "Instance '$Name' not found." "DEBUG"
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
    
    if (-not (Test-WSLInstanceExists -Name $Name)) {
        if (-not $AsJson) { Write-Error "Instance '$Name' not found." }
        return
    }
    
    $status = wsl.exe -l -v | Select-String -Pattern "^\s*\*?\s*$Name\b"
    if ($status -notmatch "Running") {
        if (-not $AsJson) { Write-Warning "Instance '$Name' is not running. Cannot monitor." }
        return
    }

    function Get-WSLMetrics {
        param ( [string]$Name )
        
        # Use -n to avoid potential escape codes/formatting issues
        $Mem = wsl.exe -d $Name -- free -m 2>$null | Select-String "Mem:"
        if ($Mem) {
            $MemParts = $Mem.ToString().Split(" ", [System.StringSplitOptions]::RemoveEmptyEntries)
            $MemVal = "$($MemParts[2])MB / $($MemParts[1])MB"
        }
        else {
            $MemVal = "Unknown"
        }
        
        $Disk = wsl.exe -d $Name -- df -h / 2>$null | Select-String "/$"
        if ($Disk) {
            $DiskParts = $Disk.ToString().Split(" ", [System.StringSplitOptions]::RemoveEmptyEntries)
            # Handle cases where the line might be different (e.g. Alpine vs Ubuntu)
            $DiskVal = "$($DiskParts[2]) / $($DiskParts[1])"
        }
        else {
            $DiskVal = "Unknown"
        }
        
        return @{
            InstanceName = $Name
            Memory       = $MemVal
            Disk         = $DiskVal
            Timestamp    = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        }
    }

    $uptime = wsl.exe -d $Name -- uptime
    $free = wsl.exe -d $Name -- free -m
    $df = wsl.exe -d $Name -- df -h /
    $ip = wsl.exe -d $Name -- ip -s link

    if ($AsJson) {
        $stats = @{
            Name    = $Name
            Uptime  = ($uptime | Out-String).Trim()
            Memory  = ($free | Out-String).Trim()
            Disk    = ($df | Out-String).Trim()
            Network = ($ip | Out-String).Trim()
        }
        $stats | ConvertTo-Json -Compress
    }
    else {
        Write-Host "`n[UPTIME & LOAD]" -ForegroundColor Yellow
        $uptime

        Write-Host "`n[MEMORY]" -ForegroundColor Yellow
        $free

        Write-Host "`n[DISK USAGE]" -ForegroundColor Yellow
        $df

        Write-Host "`n[NETWORK]" -ForegroundColor Yellow
        $ip
    }
}

function Get-WSLInstances {
    param($AsJson = $false)
    Write-WslLog "Listing instances (JSON: $AsJson)..."
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
        Write-Error "WSL instance with name '$Name' already exists. Aborting."
        exit 1
    }

    $InstallPath = Join-Path $WSL_DIR $Name
    if (Test-Path $InstallPath) {
        Write-Error "Install path '$InstallPath' already exists. Aborting."
        return
    }

    # 2. Deployment
    if (Test-Path $Base) {
        # Import from local tarball
        try {
            Import-WSLDistro -Name $Name -InstallPath $InstallPath -SourcePath $Base
            Write-Host "Instance '$Name' created successfully from $Base." -ForegroundColor Green
        }
        catch {
            Write-Error "Failed to import WSL instance: $_"
            exit 1
        }
    }
    else {
        # Clone existing distro
        $TempTar = [System.IO.Path]::GetTempFileName() + ".tar"
        try {
            Export-WSLDistro -Distro $Base -OutputPath $TempTar
            Import-WSLDistro -Name $Name -InstallPath $InstallPath -SourcePath $TempTar
            Write-Host "Instance '$Name' created successfully." -ForegroundColor Green
        }
        catch {
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
    
    Write-WslLog "Starting daemon for '$Name'..."
    Write-Host "Starting daemon for WSL instance '$Name'..." -ForegroundColor Cyan
    
    # Check if already running
    if (Test-WSLInstanceExists -Name $Name) {
        $status = wsl.exe -l -v | Select-String -Pattern "^\s*\*?\s*$Name\b"
        if ($status -match "Running") {
            Write-Host "Instance '$Name' is already running." -ForegroundColor Yellow
            Write-WslLog "'$Name' is already running. Skipping daemon start." "DEBUG"
            return
        }
    }

    # Start a background job to keep the instance alive
    Write-WslLog "Spawning background job: WSL_Daemon_$Name" "DEBUG"
    Start-Job -Name "WSL_Daemon_$Name" -ScriptBlock {
        param($n)
        wsl.exe -d $n -- exec sleep infinity
    } | Out-Null

    Write-Host "Daemon started for '$Name'. It will keep running in the background." -ForegroundColor Green
    Write-WslLog "Daemon spawned for '$Name'."
}

function Stop-WSLInstance {
    param($Name)
    
    Write-Host "Stopping WSL instance '$Name'..." -ForegroundColor Cyan
    wsl.exe --terminate $Name
    
    # Also stop any background jobs
    $job = Get-Job -Name "WSL_Daemon_$Name" -ErrorAction SilentlyContinue
    if ($job) {
        Stop-Job $job
        Remove-Job $job
    }
    
    Write-Host "Instance '$Name' stopped." -ForegroundColor Green
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
        bun run dev
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
