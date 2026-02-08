# WSL Dashboard

Management interface for WSL 2 instances. Features real-time telemetry, Alpine Linux provisioning, and integrated verification.

---

## Getting Started

### Prerequisites
- WSL 2 on Windows.
- [Bun](https://bun.sh/).
- PowerShell 5.1+.

### Installation

1. **Clone**:
   ```powershell
   git clone https://github.com/timcash/wsl-tools.git
   cd wsl-tools
   ```

2. **Run Dashboard**:
   ```powershell
   .\wsl_tools.ps1 dashboard
   ```

3. **Fetch Alpine**:
   ```powershell
   .\wsl_tools.ps1 fetch alpine
   ```

---

## CLI Reference

Entry point: `wsl_tools.ps1`.

| Command | Description |
| :--- | :--- |
| `dashboard` | Starts the Bun server. |
| `new <name> [base]` | Creates a new instance. |
| `daemon <name>` | Starts instance in background. |
| `stop <name>` | Stops a running instance. |
| `delete <name>` | Unregisters an instance. |
| `list-json` | Lists instances in JSON. |
| `monitor <name>` | Shows metrics (CPU, Memory, Disk). |

---

## Verification

Runs PowerShell commands then validates via Puppeteer.

```bash
cd src
bun run test.ts
```

---

## Documentation
- **[AGENT.md](AGENT.md)**: Testing workflow and debugging.
- **[system.md](system.md)**: Architecture overview.

# Test Result

**Run:** 2/8/2026, 1:16:18 PM | **Status:** 🔴 FAILED

> ⚠️ **ERROR SUMMARY**: FAILED: Start/Stats timeout

### ✅ 1. Backend Infrastructure Ready

```text
[13:15:10] === PHASE 1: BACKEND PREP ===
[13:15:10] [SETUP] Ensuring port 3002 is free...
[13:15:11] [CLEANUP] Removing any lingering TDD- instances...
[13:15:11] [EXEC] wsl_tools.ps1 list-json 
[13:15:11] [PS-STDOUT] [{"Name":"podman-machine-default","State":"Stopped","Version":"2"},{"Name":"test","State":"Running","Version":"2"},{"Name":"Ubuntu-24.04","State":"Stopped","Version":"2"}]
[13:15:11] [EXEC] wsl_tools.ps1 new TDD-Unified-Final alpine
[13:15:12] [PS-STDOUT] Creating new WSL instance 'TDD-Unified-Final' from 'alpine'...
Importing TDD-Unified-Final from C:\Users\timca\WSL\_bases\alpine.tar.gz into C:\Users\timca\WSL\TDD-Unified-Final...
The operation completed successfully. 
Instance 'TDD-Unified-Final' created successfully from C:\Users\timca\WSL\_bases\alpine.tar.gz.
```

### ✅ 2. Dashboard Initial Load

![2. Dashboard Initial Load](src/screenshots/step_1.png)

```text
[13:15:12] === PHASE 2: SERVER START ===
[13:15:12] [SRV-OUT] [BUILD] Transpiling C:\Users\timca\code3\wsl-tools\src\app.ts -> C:\Users\timca\code3\wsl-tools\src\dist
[13:15:12] [SRV-OUT] [BUILD] Success!
[13:15:12] [SRV-OUT] [TAIL] Starting log tail on: C:\Users\timca\code3\wsl-tools\src\powershell.log
[13:15:12] [SRV-OUT] [V2] Dashboard active at http://localhost:3002
[13:15:13] [SRV-OUT] [HTTP] GET / (rel: )
[13:15:13] [SRV-OUT] [HTTP] GET /style.css (rel: style.css)
[13:15:13] [SRV-OUT] [HTTP] GET /app.js (rel: app.js)
[13:15:13] [SRV-OUT] [HTTP] GET /wsl_cpu_network.png (rel: wsl_cpu_network.png)
[13:15:13] [BRW-CONSOLE] [WS] Attempting connection...
[13:15:13] [SRV-OUT] [WS] Client connected
[13:15:13] [BRW-CONSOLE] [WS] Connected to backend
[13:15:13] [SRV-OUT] [HTTP] GET /favicon.ico (rel: favicon.ico)
[13:15:13] [BRW-CONSOLE] Failed to load resource: the server responded with a status of 404 (Not Found)
[13:15:13] [BRW-CONSOLE] [UI_ONLINE] Instance online: test
```

### ❌ FAILED: Start/Stats timeout

```text
[13:15:13] === PHASE 3: START & TELEMETRY ===
[13:15:13] [BRW-CONSOLE] [UI_DISCOVERY] Ensuring placeholder for: TDD-Unified-Final (Starting)
[13:15:13] [SRV-OUT] [WS] Received: {"type":"start","name":"TDD-Unified-Final"}
[13:15:13] [SRV-OUT] [WS] Parsed Action: start on TDD-Unified-Final
[13:15:13] [SRV-OUT] [SERVER] Executing: daemon TDD-Unified-Final
[13:15:13] [SRV-OUT] [PS-OUT] Starting self-healing daemon for WSL instance 'TDD-Unified-Final'...
[13:15:14] [SRV-OUT] [PS-OUT] Id     Name            PSJobTypeName   State         HasMoreData     Location             Command
[13:15:14] [SRV-OUT] [PS-OUT] --     ----            -------------   -----         -----------     --------             -------
[13:15:14] [SRV-OUT] [PS-OUT] 1      WSL_Daemon_T... BackgroundJob   Running       True            localhost            ...
[13:15:14] [SRV-OUT] [PS-LOG] [2026-02-08 13:15:13] [INFO] Command Entry: daemon TDD-Unified-Final
[13:15:14] [SRV-OUT] [PS-LOG] [2026-02-08 13:15:13] [INFO] Request: Sta
[13:15:14] [SRV-OUT] rt daemon (self-healing) for 'TDD-Unified-Final'
[13:15:14] [SRV-OUT] [PS-LOG] [2026-02-08 13:15:14] [INFO] Action: Detached self-healing job (WSL_Daemon_TDD-Unified-Final)
[13:15:14] [SRV-OUT] [PS-LOG] [2026-02-08 13:15:14] [INFO] [DAEMON] Daemon loop started for TDD-Unified-Final
[13:15:14] [SRV-OUT] [PS-LOG] [2026-02-08 13:15:14] [INFO] [DAEMON] Daemon starting/ensuring TDD-Unified-Final...
[13:15:14] [BRW-CONSOLE] [UI_STOPPED] Instance stopped: podman-machine-default
[13:15:14] [BRW-CONSOLE] [UI_ONLINE] Instance online: test
[13:15:14] [BRW-CONSOLE] [UI_ONLINE] Instance online: TDD-Unified-Final
[13:15:14] [BRW-CONSOLE] [UI_STOPPED] Instance stopped: Ubuntu-24.04
[13:15:15] [SRV-OUT] [STATE] podman-machine-default: Unknown -> Stopped
[13:15:15] [SRV-OUT] [STATE] test: Unknown -> Running
[13:15:15] [SRV-OUT] [STATE] Ubuntu-24.04: Unknown -> Stopped
[13:15:15] [BRW-CONSOLE] [UI_UPDATE] Stats updated: test Mem: 534MB / 15847MB
[13:15:15] [BRW-CONSOLE] [UI_UPDATE] Stats updated: test Disk: 8.2M / 1006.9G
[13:15:16] [SRV-OUT] [PS-LOG] [2026-02-08 13:15:16] [WARN] Warning: Daemon job started but instance 'TDD-Unified-Final' still shows as [2]
[13:15:21] [BRW-CONSOLE] [UI_UPDATE] Stats updated: test Mem: 538MB / 15847MB
[13:15:24] [BRW-CONSOLE] [UI_UPDATE] Stats updated: test Mem: 536MB / 15847MB
[13:15:30] [BRW-CONSOLE] [UI_STOPPED] Instance stopped: TDD-Unified-Final
[13:15:30] [BRW-CONSOLE] [UI_UPDATE] Stats updated: test Mem: 500MB / 15847MB
[13:15:33] [BRW-CONSOLE] [UI_UPDATE] Stats updated: test Mem: 501MB / 15847MB
[13:15:36] [BRW-CONSOLE] [UI_UPDATE] Stats updated: test Mem: 502MB / 15847MB
[13:15:42] [BRW-CONSOLE] [UI_UPDATE] Stats updated: test Mem: 503MB / 15847MB
[13:15:49] [BRW-CONSOLE] [UI_UPDATE] Stats updated: test Mem: 504MB / 15847MB
[13:15:52] [BRW-CONSOLE] [UI_UPDATE] Stats updated: test Mem: 503MB / 15847MB
[13:15:55] [BRW-CONSOLE] [UI_UPDATE] Stats updated: test Mem: 504MB / 15847MB
[13:16:04] [BRW-CONSOLE] [UI_UPDATE] Stats updated: test Mem: 505MB / 15847MB
[13:16:07] [BRW-CONSOLE] [UI_UPDATE] Stats updated: test Mem: 503MB / 15847MB
[13:16:14] 
[FAIL] FAILURE: Start/Stats timeout
```

