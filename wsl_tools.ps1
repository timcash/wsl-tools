param (
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$InstanceName,

    [Parameter(Mandatory = $true, Position = 1)]
    [ValidateSet("new", "daemon", "stop", "list", "fetch", "monitor", "list-json", "monitor-json")]
    [string]$Command,

    [Parameter(Mandatory = $false, Position = 2)]
    [string]$BaseDistro = "Ubuntu"
)

# --- Configuration ---
$WSL_DIR = Join-Path $HOME "WSL"
$BASES_DIR = Join-Path $WSL_DIR "_bases"

if (-not (Test-Path $WSL_DIR)) {
    New-Item -ItemType Directory -Path $WSL_DIR | Out-Null
}
if (-not (Test-Path $BASES_DIR)) {
    New-Item -ItemType Directory -Path $BASES_DIR | Out-Null
}

# --- Helper Functions ---
function Test-WSLInstanceExists {
    param($Name)
    # Note: wsl -l --quiet outputs UTF-16LE
    $existing = wsl.exe -l --quiet | Where-Object { $_ -replace "\0", "" -match "^\s*$Name\b" }
    return [bool]$existing
}

function Export-WSLDistro {
    param($Distro, $OutputPath)
    Write-Host "Exporting $Distro to $OutputPath..." -ForegroundColor Gray
    wsl.exe --export $Distro $OutputPath
}

function Import-WSLDistro {
    param($Name, $InstallPath, $SourcePath)
    Write-Host "Importing $Name from $SourcePath into $InstallPath..." -ForegroundColor Gray
    if (-not (Test-Path $InstallPath)) {
        New-Item -ItemType Directory -Path $InstallPath | Out-Null
    }
    wsl.exe --import $Name $InstallPath $SourcePath
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
        $parsed | ConvertTo-Json -Compress
    }
    else {
        wsl.exe -l -v
    }
}

function New-WSLInstance {
    param($Name, $Base)
    
    Write-Host "Creating new WSL instance '$Name' from '$Base'..." -ForegroundColor Cyan
    
    # 1. Validation
    if (Test-WSLInstanceExists -Name $Name) {
        Write-Error "WSL instance with name '$Name' already exists. Aborting."
        return
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
            Write-Error "Failed to create WSL instance: $_"
        }
        finally {
            if (Test-Path $TempTar) { Remove-Item $TempTar -Force }
        }
    }
}

function Start-WSLDaemon {
    param($Name)
    
    Write-Host "Starting daemon for WSL instance '$Name'..." -ForegroundColor Cyan
    
    # Check if already running
    $status = wsl.exe -l -v | Select-String -Pattern "^\s*\*?\s*$Name\b"
    if ($status -match "Running") {
        Write-Host "Instance '$Name' is already running." -ForegroundColor Yellow
        return
    }

    # Start a background job to keep the instance alive
    Start-Job -Name "WSL_Daemon_$Name" -ScriptBlock {
        param($n)
        wsl.exe -d $n -- exec sleep infinity
    } | Out-Null

    Write-Host "Daemon started for '$Name'. It will keep running in the background." -ForegroundColor Green
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
}
