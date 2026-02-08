# WSL Tools

Manage WSL instances using Alpine Linux and real-time monitoring.

---

## Quick Start (Alpine Minimal)

1.  **Start Dashboard**:
    ```powershell
    .\wsl_tools.ps1 dashboard
    ```
2.  **Fetch Alpine rootfs**:
    ```powershell
    .\wsl_tools.ps1 alpine fetch
    ```
2.  **Create & Start Environment**:
    ```powershell
    # Creates an Alpine instance (nearly instant)
    .\wsl_tools.ps1 new my-env
    # Starts the instance in the background
    .\wsl_tools.ps1 daemon my-env
    ```

---

## Web Dashboard

A real-time fleet management interface with row-based metrics and D3.js visualizations.

### Features
- **Instant Lifecycles**: Default Alpine-based creation in seconds.
- **Daemon Control**: Start/Stop instances directly from the browser.
- **Provisioning**: execute shell commands (e.g., `apk add git`) via WebSocket.
- **Live Graphs**: Moving-window D3.js memory metrics.

### Running the Dashboard
```bash
cd web_v2
bun install
bun start
```
Navigate to the logged `http://localhost:PORT`.

---

## CLI Reference

Syntax:
```powershell
.\wsl_tools.ps1 <command> [<instance_name>] [<base_distro_or_path>]
```

| Command | Description |
| :--- | :--- |
| `fetch` | Downloads Alpine minirootfs for fast initialization. |
| `new` | Creates a new instance. Defaults to Alpine for speed. |
| `daemon` | Keeps the instance alive via background spawn. |
| `stop` | Gracefully terminates the instance and cleanup. |
| `monitor` | Linux metrics: `uptime`, `free`, `df`, `ip link`. |
| `dashboard` | Starts the Bun web server for the visual dashboard. |
| `list` | Lists all registered WSL instances. |
| `list-json` | JSON output for dashboard integration. |

---

## Automated Verification

### Dashboard Lifecycle Test
Verifies the full loop from creation to provisioning:
```bash
cd src
bun run test.ts
```
**Test Flow**: Creation -> Detection -> Start -> `apk add git bash` -> `git clone dialtone`.

### Complex Integration
```powershell
.\test_complex_setup.ps1
```
Mirrors the dashboard provisioning logic in pure PowerShell.

---

## Requirements
- WSL 2
- PowerShell 5.1+
- Bun (for Dashboard & Tests)

# Test Result

**Last Run:** 2/8/2026, 9:44:23 AM  
**Status:** ❌ FAILED  

### Performance Metrics

| Metric | Value |
| :--- | :--- |
| Total Test Time | 92.61s |
| WSL Instance Start | 30.07s |
| SSH Latency | 52.85ms |
| File Write Latency | 31.41ms |
| Stats Verified | ❌ NO |
| Online Verified | ❌ NO |

### Error Summary

*No errors detected.*

### Visual Verification

#### Initial Load
![Initial Load](src/screenshots/screenshot_initial.png)

#### After Adding Instance
❌ FAILED: UI_ONLINE event not received

#### Final State
❌ FAILED: Final verification or Stats update failed

### PowerShell Log Report

```text
[2026-02-08 09:44:08] [INFO] Instance 'Ubuntu-24.04' exists.
[2026-02-08 09:44:11] [INFO] Command Entry: list-json 
[2026-02-08 09:44:11] [INFO] Listing instances (JSON: True)...
[2026-02-08 09:44:11] [DEBUG] Instances found: 2
[2026-02-08 09:44:11] [INFO] Command Entry: monitor-json Ubuntu-24.04
[2026-02-08 09:44:11] [INFO] Checking existence for 'Ubuntu-24.04'...
[2026-02-08 09:44:11] [INFO] Instance 'Ubuntu-24.04' exists.
[2026-02-08 09:44:14] [INFO] Command Entry: list-json 
[2026-02-08 09:44:14] [INFO] Listing instances (JSON: True)...
[2026-02-08 09:44:14] [DEBUG] Instances found: 2
[2026-02-08 09:44:14] [INFO] Command Entry: monitor-json Ubuntu-24.04
[2026-02-08 09:44:14] [INFO] Checking existence for 'Ubuntu-24.04'...
[2026-02-08 09:44:14] [INFO] Instance 'Ubuntu-24.04' exists.
[2026-02-08 09:44:17] [INFO] Command Entry: list-json 
[2026-02-08 09:44:17] [INFO] Listing instances (JSON: True)...
[2026-02-08 09:44:17] [DEBUG] Instances found: 2
[2026-02-08 09:44:17] [INFO] Command Entry: monitor-json Ubuntu-24.04
[2026-02-08 09:44:17] [INFO] Checking existence for 'Ubuntu-24.04'...
[2026-02-08 09:44:17] [INFO] Instance 'Ubuntu-24.04' exists.
[2026-02-08 09:44:20] [INFO] Command Entry: list-json 
[2026-02-08 09:44:20] [INFO] Listing instances (JSON: True)...
[2026-02-08 09:44:20] [DEBUG] Instances found: 2
[2026-02-08 09:44:20] [INFO] Command Entry: monitor-json Ubuntu-24.04
[2026-02-08 09:44:20] [INFO] Checking existence for 'Ubuntu-24.04'...
[2026-02-08 09:44:20] [INFO] Instance 'Ubuntu-24.04' exists.
[2026-02-08 09:44:23] [INFO] Command Entry: list-json 
[2026-02-08 09:44:23] [INFO] Listing instances (JSON: True)...
[2026-02-08 09:44:23] [DEBUG] Instances found: 2
[2026-02-08 09:44:23] [INFO] Command Entry: monitor-json Ubuntu-24.04
[2026-02-08 09:44:23] [INFO] Checking existence for 'Ubuntu-24.04'...
```

## Test Result

**Last Run:** 2/8/2026, 10:12:54 AM  
**Status:** ❌ FAILED  

### Metrics

| Metric | Status |
| :--- | :--- |
| Total Time | 66.20s |
| Backend-First | ❌ Failed |
| Live discovery | ❌ NO |

### Trace
```text
[10:11:47 AM] [TEST] Starting Dashboard Server internally...
[10:11:48 AM] [TEST] Dashboard active at http://localhost:60465
[10:11:48 AM] PHASE 1: Backend Verification (Pre-flight-Backend-Test)
[10:11:48 AM] [BACKEND] Cleaning up potential stale instance: Pre-flight-Backend-Test
[10:11:48 AM] [BACKEND] Running: powershell delete Pre-flight-Backend-Test
[10:11:48 AM] [BACKEND] Running: powershell list-json
[10:11:49 AM] [BACKEND] Initial instance count: 2
[10:11:49 AM] [BACKEND] Running: powershell new Pre-flight-Backend-Test alpine
[10:11:50 AM] [BACKEND] Creation successful.
[10:11:50 AM] ✅ SUCCESS: Backend creation verified in powershell.log
[10:11:51 AM] [BACKEND] Running: powershell list-json
[10:11:51 AM] ✅ SUCCESS: Instance verified via list-json. Count: 3
[10:11:51 AM] [BACKEND] Starting daemon for Pre-flight-Backend-Test
[10:11:51 AM] [BACKEND] Running: powershell daemon Pre-flight-Backend-Test
[10:11:51 AM] PHASE 2: Browser Verification
[10:11:51 AM] [BROWSER][ERROR] Failed to load resource: the server responded with a status of 404 (Not Found)
[10:11:52 AM] [BROWSER][ERROR] error-ping
[10:11:53 AM] Checking for Pre-flight-Backend-Test in UI...
[10:12:53 AM] ❌ FAILED: UI Online event timeout (Pre-flight-Backend-Test)
[10:12:53 AM] ❌ FAILED: Pre-flight-Backend-Test not running or missing from UI.
[10:12:54 AM] [TEST] Stopping Dashboard Server...
```

### UI Errors

*No errors.*

### Visual Audit

#### Ready State
![Ready](src/screenshots/screenshot_initial.png)

#### Online State
❌ Missing

#### Final State
❌ Missing
