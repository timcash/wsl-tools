param (
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet("new", "start", "daemon", "stop", "list", "fetch", "monitor", "list-json", "monitor-json", "dashboard", "ssh", "delete", "unregister", "persist", "unpersist")]
    [string]$Command,

    [Parameter(Mandatory = $false, Position = 1)]
    [string]$InstanceName,

    [Parameter(Mandatory = $false, Position = 2)]
    [string]$BaseDistro = "Ubuntu",

    [Parameter(Mandatory = $false)]
    [int]$Port = 3000
)

# Handle Unix-style --port flag for the dashboard command
if ($Command -eq "dashboard") {
    if ($InstanceName -eq "--port" -and $BaseDistro -match "^\d+$") {
        $Port = [int]$BaseDistro
        $InstanceName = $null
        $BaseDistro = "Ubuntu"
    }
}

# Force UTF-8 for clean output to the dashboard
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

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
    
    # Aggressive sanitization to prevent "flashing" and broken terminal rendering
    $cleanMessage = $Message -replace "\x00", "" -replace "[\x00-\x08\x0B\x0C\x0E-\x1F]", ""
    $logLine = "[$timestamp] [$Level] $cleanMessage"
    
    try {
        $logDir = [System.IO.Path]::GetDirectoryName($LOG_FILE)
        if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
        $logLine | Out-File -FilePath $LOG_FILE -Append -Encoding utf8 -ErrorAction SilentlyContinue
    } catch {}
}

function Invoke-WslCommand {
    param($ArgsList)
    $cmdString = "wsl.exe " + ($ArgsList -join " ")
    Write-WslLog "Executing: $cmdString" "DEBUG" -Quiet $true
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
        $lines = wsl.exe -l -v
        $tasks = Get-ScheduledTask -TaskName "WSL_Persist_*" -ErrorAction SilentlyContinue

        $parsed = $lines | Select-Object -Skip 1 | Where-Object { $_ -match "\w" } | ForEach-Object {
            $line = $_ -replace "\x00", "" -replace "^\s*\*\s*", "" -replace "^\s+", ""
            $parts = $line -split "\s+"
            if ($parts.Count -ge 3) {
                $name = $parts[0]
                $isPersisted = $null -ne ($tasks | Where-Object { $_.TaskName -eq "WSL_Persist_$name" })
                [PSCustomObject]@{
                    Name      = $name
                    State     = $parts[1]
                    Version   = $parts[2]
                    Persisted = $isPersisted
                }
            }
        }
        $json = $parsed | ConvertTo-Json -Compress
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
    
    if ($Base -eq "alpine" -and -not (Test-Path $Base)) {
        $PossibleAlpine = Join-Path $BASES_DIR "alpine.tar.gz"
        if (Test-Path $PossibleAlpine) {
            Write-WslLog "Auto-resolved 'alpine' to $PossibleAlpine" "DEBUG"
            $Base = $PossibleAlpine
        }
    }
    
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

    if (Test-Path $Base) {
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
            if (Test-Path $InstallPath) { Remove-Item $InstallPath -Recurse -Force -ErrorAction SilentlyContinue }
            exit 1
        }
        finally {
            if (Test-Path $TempTar) { Remove-Item $TempTar -Force }
        }
    }
}

function Start-WSLSimple {
    param($Name)
    Write-WslLog "Request: Simple start (non-daemon) for '$Name'"
    Write-Host "Starting WSL instance '$Name' in background (no self-healing)..." -ForegroundColor Cyan
    Start-Process -FilePath "wsl.exe" -ArgumentList "-d", $Name, "-u", "root", "--", "sh", "-c", "while true; do sleep 3600; done" -NoNewWindow
    Start-Sleep -Seconds 2
    Write-Host "Instance started." -ForegroundColor Green
}

function Start-WSLDaemon {
    param($Name)
    
    Write-WslLog "Request: Start daemon (self-healing) for '$Name'"
    Write-Host "Starting self-healing daemon for WSL instance '$Name'..." -ForegroundColor Cyan
    
    $jobName = "WSL_Daemon_$Name"
    if (Get-Job -Name $jobName -ErrorAction SilentlyContinue) {
        Write-Host "Daemon for '$Name' is already running (Job: $jobName)." -ForegroundColor Yellow
        Write-WslLog "'$Name' daemon job already exists. Skipping." "DEBUG"
        return
    }

    # Start the job
    $scriptBlock = {
        param($distro, $logPath)
        
        function Job-Log {
            param($msg, $level = "INFO")
            try {
                $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
                Add-Content -Path $logPath -Value "[$ts] [$level] [DAEMON] $msg" -ErrorAction SilentlyContinue
            } catch {}
        }

        Job-Log "Daemon loop started for ${distro}"
        
        try {
            while ($true) {
                try {
                    Job-Log "Daemon starting/ensuring ${distro}..."
                    # We use Start-Process -Wait because it's much better at detecting the exit 
                    # of the primary wsl.exe process even if the instance is terminated externally.
                    $p = Start-Process -FilePath "wsl.exe" -ArgumentList "-d", $distro, "-u", "root", "--", "sh", "-c", "while true; do sleep 3600; done" -NoNewWindow -PassThru -ErrorAction Stop
                    $p.WaitForExit()
                    Job-Log "Daemon process for ${distro} exited (Code: $($p.ExitCode))." "WARN"
                }
                catch {
                    Job-Log "Daemon encountered error for ${distro}: $_" "ERROR"
                }
                
                Job-Log "Restarting in 5s..."
                Start-Sleep -Seconds 5
            }
        }
        catch {
            Job-Log "CRITICAL: Daemon loop for ${distro} crashed: $_" "ERROR"
        }
    }

    Start-Job -Name $jobName -ScriptBlock $scriptBlock -ArgumentList $Name, $LOG_FILE
    Write-WslLog "Action: Detached self-healing job ($jobName)"
    
    Start-Sleep -Seconds 2
    
    $statusLine = wsl.exe -l -v | Select-String -Pattern "^\s*\*?\s*$Name\b"
    if ($statusLine -match "Running") {
        Write-Host "Daemon started and verified for '$Name'." -ForegroundColor Green
        Write-WslLog "Status: Verified 'Running' for '$Name'."
    } else {
        Write-WslLog "Warning: Daemon job started but instance '$Name' still shows as $($statusLine -split '\s+')[2]" "WARN"
    }
}

function Register-WslTask {
    param($Name)
    $TaskName = "WSL_Persist_$Name"
    
    Write-Host "Registering Windows Task '$TaskName' for reboot persistence..." -ForegroundColor Cyan
    
    $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSScriptRoot\wsl_tools.ps1`" daemon $Name"
    $trigger = New-ScheduledTaskTrigger -AtLogOn 
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERNAME" -LogonType Interactive
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
    
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force
    
    Write-Host "Task registered. $Name will now start automatically when you log in." -ForegroundColor Green
}

function Unregister-WslTask {
    param($Name)
    $TaskName = "WSL_Persist_$Name"
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Write-Host "Removing Windows Task '$TaskName'..." -ForegroundColor Yellow
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    }
}

function Stop-WSLInstance {
    param($Name)
    
    Write-WslLog "Request: Stop instance '$Name'"
    Write-Host "Stopping WSL instance '$Name'..." -ForegroundColor Cyan
    
    # 1. Stop the self-healing job first
    $jobName = "WSL_Daemon_$Name"
    $job = Get-Job -Name $jobName -ErrorAction SilentlyContinue
    if ($job) {
        Write-WslLog "Action: Stopping daemon job $jobName" "DEBUG"
        Stop-Job $job
        Remove-Job $job
    }

    # 2. Terminate the instance itself
    wsl.exe --terminate $Name
    
    # 3. Find and kill any lingering wsl.exe processes for this instance
    $procs = Get-CimInstance Win32_Process -Filter "Name = 'wsl.exe'" | Where-Object { $_.CommandLine -match "-d\s+$Name\b" }
    foreach ($p in $procs) {
        Write-WslLog "Action: Killing background wsl process $($p.ProcessId) for $Name" "DEBUG"
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }

    # 4. If it is a TDD instance, be even more aggressive
    if ($Name.StartsWith("TDD-")) {
        Start-Sleep -Seconds 1
        wsl.exe --terminate $Name
    }

    Start-Sleep -Seconds 2
    Write-Host "Instance '$Name' stopped and background jobs cleared." -ForegroundColor Green
    Write-WslLog "Status: Instance '$Name' stopped."
}

# --- Main Switch ---
switch ($Command) {
    "new" { New-WSLInstance -Name $InstanceName -Base $BaseDistro }
    "start" { Start-WSLSimple -Name $InstanceName }
    "daemon" { Start-WSLDaemon -Name $InstanceName }
    "stop" { Stop-WSLInstance -Name $InstanceName }
    "list" { Get-WSLInstances -AsJson $false }
    "list-json" { Get-WSLInstances -AsJson $true }
    "fetch" { Save-WSLBase -Type $BaseDistro }
    "monitor" { Measure-WSLInstance -Name $InstanceName -AsJson $false }
    "monitor-json" { Measure-WSLInstance -Name $InstanceName -AsJson $true 2>&1 }
    "dashboard" {
        $WebDir = Join-Path $PSScriptRoot "src"
        Write-Host "--- Dashboard Diagnostics (v2) ---" -ForegroundColor Gray
        
        $Conflict = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | Where-Object { $_.State -eq 'Listen' }
        if ($Conflict) {
            Write-Warning "Port $Port is already in use by PID $($Conflict.OwningProcess)."
        }

        Write-Host "`nStarting WSL Dashboard on port $Port from $WebDir..." -ForegroundColor Cyan
        Set-Location $WebDir
        
        $env:PORT = $Port
        $job = Start-Job -ScriptBlock {
            param($dir, $p)
            Set-Location $dir
            $env:PORT = $p
            # Call bun directly and merge stderr into stdout to avoid NativeCommandError in PS
            & bun --watch server.ts --port $p 2>&1
        } -ArgumentList $WebDir, $Port

        Write-Host "`n🚀 Dashboard initialization started: http://localhost:$Port" -ForegroundColor Green
        Write-Host "Press Ctrl+C to stop (terminates background job)." -ForegroundColor Gray
        Receive-Job -Job $job -Wait
    }
    "ssh" {
        wsl.exe -d $InstanceName
    }
    "persist" { Register-WslTask -Name $InstanceName }
    "unpersist" { Unregister-WslTask -Name $InstanceName }
    "unregister" {
        Unregister-WslTask -Name $InstanceName
        Stop-WSLInstance -Name $InstanceName
        Write-Host "Unregistering WSL instance '$InstanceName'..." -ForegroundColor Cyan
        wsl.exe --unregister $InstanceName
    }
    "delete" {
        Unregister-WslTask -Name $InstanceName
        Stop-WSLInstance -Name $InstanceName
        Write-Host "Unregistering WSL instance '$InstanceName'..." -ForegroundColor Cyan
        wsl.exe --unregister $InstanceName
    }
}