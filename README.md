<div align="center">
  <img src="wsl_octopus.png" width="300" alt="WSL Tools Octopus">
</div>

# WSL Tools

A modular PowerShell utility for managing WSL instances. It facilitates cloning distributions, running background services (daemonization), and managing instance lifecycles using standard `wsl.exe` commands.

---

## Quick Start

1.  **Fetch Alpine Linux** (Minimal rootfs):
    ```powershell
    .\wsl_tools.ps1 alpine fetch
    ```
2.  **Create Instance**:
    ```powershell
    .\wsl_tools.ps1 my-dev-env new ~/WSL/_bases/alpine.tar.gz
    ```
3.  **Daemonize**:
    ```powershell
    .\wsl_tools.ps1 my-dev-env daemon
    ```

---

## CLI Reference

Syntax:
```powershell
.\wsl_tools.ps1 <instance_name> <command> [<base_distro_or_path>]
```

| Command | Description |
| :--- | :--- |
| `fetch` | Downloads Alpine Linux minirootfs to `~/WSL/_bases/`. |
| `new` | Imports a new instance from a tarball or clones an existing distro. |
| `daemon` | Starts a background job executing `sleep infinity` to keep the instance active. |
| `monitor` | Reports real-time CPU, Memory, Disk, and Network usage from within the instance. |
| `stop` | Terminates the instance (`wsl --terminate`) and removes the background job. |
| `list` | Lists all registered WSL instances (`wsl -l -v`). |
| `list-json` | Returns a JSON array of instances with status details. |
| `monitor-json` | Returns a JSON object of resource usage for tool consumption. |

### Resource Monitoring (`monitor`)
Executes standard Linux tools inside the instance to report usage:
- **Uptime**: `uptime`
- **Memory**: `free -m`
- **Disk**: `df -h /`
- **Network**: `ip -s link`

Example output:
```text
[MEMORY]
              total        used        free      shared  buff/cache   available
Mem:          32056         412       31000           1         643       31278
```

### Safety & cleanup
- **Overwrite Protection**: Checks for existing instance names and valid filesystem paths before creation.
- **Test Isolation**: Test suites use randomized IDs (`wsl-tools-test-XXXX`) to avoid conflicts with existing environments.

---

## Web Dashboard

A unified, real-time interface for managing your WSL fleet.

### Features
- **Real-time Monitoring**: Live updates of CPU, RAM, Disk, and Network usage via WebSockets.
- **Modern UI**: Dark-themed, responsive interface powered by standard web technologies.
- **Bun Backend**: fast, efficient server handling process spawning and WebSocket broadcasting.

### Quick Start
1.  **Install Dependencies**:
    ```bash
    cd web
    bun install
    ```
2.  **Run Server**:
    ```bash
    bun run server.ts
    ```
3.  **Open Dashboard**:
    Navigate to `http://localhost:3000` (or the port logged in the terminal).

---

## Testing

- **Unit Tests**: `.\test_wsl_tools.ps1`
  - Verifies overwrite protection mechanisms.
  - Verifies daemon job creation and cleanup.
- **Integration**: `.\test_complex_setup.ps1`
  - Performs a full lifecycle test: create -> provision (user/git) -> monitor -> cleanup.
  - Uses a randomized instance name for safety.
- **Web Verification**: `web/test_dashboard.ts`
  - Uses **Puppeteer** to verify the dashboard.
  - Checks page title, screenshots the UI, and validates error interception.
  - **Run**: `cd web; bun run test_dashboard.ts`

## Requirements
- WSL 2
- PowerShell 5.1+