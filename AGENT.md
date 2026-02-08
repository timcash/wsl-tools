# AGENT.md - WSL Tools Testing & TDD Workflow

> [!IMPORTANT]
> **CURRENT ISSUES (Feb 8, 2026)**
> 1. **Terminal Flashing**: PowerShell and `wsl.exe` output null bytes (`\0`) that cause terminal flickering. We are aggressively sanitizing `stdout` in the script and server to fix this.
> 2. **WSL Propagation Delay**: WSL sometimes reports "Running" while still terminating. The test suite now includes 7s "settle" periods during self-healing checks.
> 3. **Task Scheduler Permissions**: `persist` requires the user to be in the "Administrators" group to register startup tasks.

This project follows a strict **TDD (Test-Driven Development)** and **Log-Focused** architecture. Verification is driven by Puppeteer, which orchestrates the frontend and validates system state through intercepted telemetry.

## 🧪 Testing Infrastructure

### 1. `src/test.ts` (The Orchestrator)
The primary test suite manages the full lifecycle:
- **Isolation**: The test suite uses a dedicated port (default 3002) and only manages instances prefixed with `TDD-`.
- **Phase 6 (Self-Healing)**: Starts a daemon, runs `wsl --terminate`, and verifies the instance turns back on automatically after 5s.
- **Phase 7 (OS Persistence)**: Registers a Windows Scheduled Task and verifies its existence in the OS registry.

### 3. Self-Healing & Persistence
- **Daemon Mode**: A persistent PowerShell job that monitors a WSL instance. If the instance dies, the job restarts it after a 5-second cooldown.
- **OS Persistence**: Uses Windows Task Scheduler to register instances to start automatically **At Log On**.

## 🛠️ Repository Workflow

### 🖥️ Running the Dashboard
```powershell
.\wsl_tools.ps1 dashboard
```

### 🧪 Working with Tests
```bash
cd src
bun run test.ts
```

## 🚀 Next Steps & Roadmap

- [x] **OS Persistence**: Integrated with Windows Task Scheduler (`persist` / `unpersist`).
- [ ] **UI Persistence Toggle**: Add a "Pin" icon to the dashboard to toggle OS-level persistence.
- [ ] **Visual Telemetry**: Transition from text-based stats to sparkline graphs.
