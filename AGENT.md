# AGENT.md - WSL Tools Testing & TDD Workflow

This project follows a strict **TDD (Test-Driven Development)** and **Log-Focused** architecture. Verification is driven by Puppeteer, which orchestrates the frontend and validates system state through intercepted telemetry.

## 🧪 Testing Infrastructure

### 1. `src/test.ts` (The Orchestrator)
The primary test suite is built on **Puppeteer** and **Bun**. It manages the full lifecycle:
- **Phase 1: Backend Verification**: Independently verifies `wsl_tools.ps1` commands (`new`, `delete`, `list-json`) to ensure the foundation is solid before involving the network/UI layers.
- **Phase 2: Unified Trace**: Launches the dashboard and browser, performing an end-to-end trace from UI action -> WebSocket -> PowerShell -> File Log -> UI Telemetry.

### 2. Unified Logging
All logs are consolidated into `src/test.log` and the `README.md` report:
- **Server Logs**: Prefixed with `[SRV-OUT]` or `[SRV-ERR]`.
- **PowerShell Logs**: Captured from `powershell.log` and echoed with `[PS-LOG]`.
- **Browser Logs**: Intercepted from the console and prefixed with `[BRW-CONSOLE]`.

## 🛠️ Troubleshooting & Debugging

If a test fails, follow this triage order:

1.  **Check `src/test.log`**: This is the unified stream. Look for the "Unified Trace" to see exactly where the command died (e.g., did the server receive the WS message?).
2.  **JSON Parse Errors**: If you see `Unexpected end of JSON input`, it usually means a PowerShell command output log noise to `stdout`. 
    - **Fix**: Ensure all logs in `wsl_tools.ps1` use `Write-WslLog` (which only writes to file) and avoid `Write-Output` for anything other than raw data.
3.  **File Locking (`powershell.log`)**: The log file may occasionally be locked by PowerShell while the Bun server tries to tail it. 
    - **Resolution**: The server uses `Bun.file().slice()` for non-locking reads, and the PowerShell script is configured to silently continue on log-write failures.
4.  **"Unknown" Stats**: Freshly created Alpine instances may report `Unknown` for Memory/Disk for the first few seconds while the WSL VM initializes. The test suite is now configured to accept these as valid telemetry heartbeats.
5.  **WSL Daemon Persistence**: If an instance stays `Stopped` despite a `start` command, verify the `Start-WSLDaemon` function in `wsl_tools.ps1`. It uses `Start-Process` to detach the `sleep infinity` process from the caller's session.

## 🚀 How to Run Tests

1.  **Execute Unified Suite**:
    ```bash
    cd src
    bun run test.ts
    ```
2.  **Review Results**:
    Check the bottom of `README.md` for the full **Unified Execution Trace**. This report is overwritten on every run to provide immediate feedback on the latest build's health.