# AGENT.md - WSL Tools Testing & TDD Workflow

> [!IMPORTANT]
> **CURRENT STATE (Feb 8, 2026)**
> 1. **Terminal Flashing**: Partially mitigated. We aggressively strip null bytes (`\0`) in PowerShell and the Bun server to prevent terminal flickering during high-frequency logging.
> 2. **Daemon distinction**: The UI now distinguishes between **Start** (standard background) and **Daemon** (self-healing loop).
> 3. **OS Persistence**: Managed via Windows Task Scheduler (`persist` command). Requires Administrator privileges for registration.

## 🧪 Testing Infrastructure

### 1. `src/test.ts` (The Orchestrator)
The primary test suite manages the full lifecycle:
- **Phase 1-2**: Backend verification and Dashboard initialization.
- **Phase 3**: Telemetry and Stats flow verification.
- **Phase 4-5**: Graceful Stop and Instance deletion.
- **Phase 6 (Self-Healing)**: Starts a daemon, runs `wsl --terminate`, and verifies the instance turns back on automatically after 5s.
- **Phase 7 (OS Persistence)**: Registers a Windows Scheduled Task and verifies its existence via `Get-ScheduledTask`.

### 3. Self-Healing & Persistence
- **Non-Daemon Mode (`start`)**: Launches the instance using `wsl.exe`. If the process is killed, it stays dead.
- **Daemon Mode (`daemon`)**: A persistent PowerShell job monitors the instance and restarts it automatically if it exits unexpectedly.
- **OS Persistence (`persist`)**: Registers a Windows Task set to "At Log On" that ensures the Daemon starts whenever the user logs into Windows.

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

- [x] **Self-Healing Daemon**: Implemented via PowerShell jobs.
- [x] **OS Persistence**: Integrated with Windows Task Scheduler.
- [ ] **UI Persistence Toggle**: Add a "Pin" icon to the dashboard table to toggle OS-level persistence directly from the web.
- [ ] **Terminal Integration**: Button to spawn a real Windows Terminal window into the instance.
- [ ] **Visual Telemetry**: Real-time sparkline graphs for CPU/Memory history.