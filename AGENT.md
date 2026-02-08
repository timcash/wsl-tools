# AGENT.md - WSL Tools Testing & TDD Workflow

This project follows a strict **TDD (Test-Driven Development)** and **Log-Focused** architecture. Verification is driven by Puppeteer, which orchestrates the frontend and validates system state through intercepted telemetry.

## 🧪 Testing Infrastructure

### 1. `src/test.ts` (The Orchestrator)
The primary test suite manages the full lifecycle:
- **Isolation**: The test suite uses a dedicated port (default 3002) and only manages instances prefixed with `TDD-`. This allows you to run the development dashboard while simultaneously running tests.
- **Phase 1: Backend Verification**: Independently verifies `wsl_tools.ps1` commands (`new`, `delete`, `list-json`) to ensure the foundation is solid.
- **Phase 2: Unified Trace**: Launches the dashboard and browser, performing an end-to-end trace from UI action -> WebSocket -> PowerShell -> File Log -> UI Telemetry.

### 2. Unified Logging & Sanitization
All logs are consolidated into `src/test.log` and the `README.md` report.
- **Sanitization**: All output is forced to UTF-8 and sanitized to strip null bytes (`\0`) and non-printable characters that cause "strange squares" in Windows stdout.
- **Flow**: PowerShell (stderr) -> Bun Server (stdout) -> Puppeteer Console -> Unified Test Log.

## 🛠️ Repository Workflow

### 🖥️ Running the Dashboard
The dashboard uses Bun in watch mode for live-reload of `app.ts` and `style.css`.
```powershell
# Default port 3000
.\wsl_tools.ps1 dashboard

# Custom port
.\wsl_tools.ps1 dashboard -Port 8080
```

### 📋 High-Density UI
The UI is a spreadsheet-style table designed for maximum information density:
- **Instance**: Name of the WSL distribution.
- **Status**: Real-time state (Running, Stopped, etc.).
- **Memory/Storage**: Live telemetry.
- **Actions**: Start, Stop, Delete, and **Copy Command** (copies `wsl -d <name>` to clipboard).

### 🧪 Working with Tests
Tests are designed to be non-destructive to your existing WSL instances.
- **Prefixing**: Only instances named `TDD-*` are touched by the automated suite.
- **Port Management**: The test suite will automatically attempt to free its target port (3002) before starting the internal test server.
- **Aggressive Stop**: For `TDD-` instances, the `stop` command is more aggressive to prevent auto-restart loops during verification.

## 🛠️ Troubleshooting

1.  **Check `src/test.log`**: This is the unified stream.
2.  **JSON Parse Errors**: Usually caused by PowerShell logging to `stdout`. Use `Write-WslLog` in the script to ensure logs stay in `stderr` or the log file.
3.  **Process Hanging**: If a test hangs, check if a background `wsl.exe` process is stuck. The test suite attempts to kill these, but manual intervention (`wsl --shutdown`) may be needed in extreme cases.

## 🚀 Next Steps & Roadmap

- [ ] **Terminal Integration**: Add a button to spawn a real Windows Terminal window directly into the instance.
- [ ] **Bulk Actions**: Implement "Start All" and "Stop All" for managed fleets.
- [ ] **Resource Graphs**: Transition from text-based telemetry to small sparkline graphs for CPU/Memory history.
- [ ] **Distro Templates**: Support custom rootfs templates beyond the default Alpine mini-rootfs.
- [ ] **WSL Settings**: UI for modifying `.wslconfig` and instance-specific flags (like memory limits).
