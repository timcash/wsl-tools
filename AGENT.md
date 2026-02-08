# AGENT.md - WSL Tools Testing & TDD Workflow

> [!IMPORTANT]
> **CURRENT STATE (Feb 8, 2026)**
> 1. **Zero-Flicker Logging**: Aggressive sanitization logic implemented in `src/server.ts` to strip all control characters (except `\n`) from PowerShell output streams.
> 2. **Unified Persistence**: The "Daemon" feature now automatically handles OS-level persistence. Starting a daemon registers a Windows Scheduled Task; stopping it removes the task.
> 3. **Modular Testing**: The test suite supports targeted execution via CLI flags to speed up development cycles.

## 🧪 Testing Infrastructure

### 1. `src/test.ts` (The Orchestrator)
The primary test suite manages the full lifecycle across several phases. You can run all tests or use flags to target specific functionality:

| Flag | Description | Phases Included |
| :--- | :--- | :--- |
| (none) | Full Suite | 1, 2, 3, 4, 5, 6, 7 |
| `--telemetry` | Stats Flow | 1, 2, 3 |
| `--stop` | UI Stop Flow | 1, 2, 4 |
| `--delete` | UI Delete Flow | 1, 2, 5 |
| `--daemon` | Self-Healing | 1, 2, 6 |
| `--pin` | OS Persistence | 1, 2, 7 |

### 2. Usage Examples
```bash
# Run only the persistence (Windows Task Scheduler) tests
cd src
bun run test.ts --pin

# Run only self-healing verification
bun run test.ts --daemon
```

## 🛠️ Repository Workflow

### 🖥️ Running the Dashboard
```powershell
# Start on default port 3000
.\wsl_tools.ps1 dashboard

# Start on custom port with watch-mode enabled
.\wsl_tools.ps1 dashboard --port 3005
```

### 🧪 Working with Tests
Tests utilize Puppeteer to verify the UI state and PowerShell to verify the system state.
- **Port Isolation**: The dashboard and tests use port-specific signal files (`.port.3000`, `.port.3002`) to allow parallel execution without interference.

## 🚀 Next Steps & Roadmap

- [x] **Self-Healing Daemon**: Implemented via PowerShell jobs.
- [x] **OS Persistence**: Integrated with Windows Task Scheduler.
- [x] **Unified UI**: Daemon button now toggles both immediate healing and OS-level persistence.
- [x] **Modular Tests**: Targeted testing via CLI flags.
- [ ] **Terminal Integration**: Button to spawn a real Windows Terminal window into the instance.
- [ ] **Visual Telemetry**: Real-time sparkline graphs for CPU/Memory history.
