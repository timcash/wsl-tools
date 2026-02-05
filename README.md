<div align="center">
  <img src="wsl_cpu_network.png" width="300" alt="WSL Tools CPU Network">
</div>

# WSL Tools
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](http://makeapullrequest.com)

A robust management suite for WSL instances, optimizing lifecycles using Alpine Linux and real-time monitoring.

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

### running the Dashboard
```bash
cd web
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
cd web
bun test
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