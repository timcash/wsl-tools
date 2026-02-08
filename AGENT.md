# AGENT.md - WSL Tools Testing & TDD Workflow

This project follows a strict **TDD (Test-Driven Development)** and **Log-Focused** architecture. Verification is driven by Puppeteer, which orchestrates the frontend and validates system state through intercepted telemetry.

## 🧪 Testing Infrastructure

### 1. `src/test.ts` (The Orchestrator)
The primary test suite is built on **Puppeteer** and **Bun**. It manages the full lifecycle:
- **Connectivity**: Connects to the dashboard via a fixed debug port.
- **Handshake (`error-ping`)**: Before functional tests begin, the script sends an `error-ping` via `console.error` and waits for detection. This ensures the browser-to-test bridge is fully operational.
### 2. High-Fidelity Error Reporting
Verification is primarily **Log-Focused**, with a deep emphasis on error resolution:
- **`test_error.log`**: Every browser-side error is captured with its full **stack trace** and stored in this dedicated file.
- **README Reporting**: The first detected stack trace for each error type is summarized in the `README.md` report, providing immediate context without leaving the documentation.
- **Handshake Protocol**: Uses the `error-ping` handshake for 100% test bridge stability.

### 🔄 The Verification Loop
This project ensures reliability through a "Backend-First" closed-loop process. This approach is superior to tradition UI-first testing as it verifies the source of truth before the representation.

1. **Phase 1: Backend Verification**: Before browser automation, the suite executes direct PowerShell commands (`list`, `monitor`) to verify backend integrity. 
   - **Cleanup**: The test suite now automatically detects and `unregister`s any stale `Pre-flight-Backend-Test` instance using the `delete` command.
   - **Validation**: It asserts that the instance count increases by exactly 1 after creation.
2. **Step-by-Step Logging**: A `StepLogger` captures a chronological trace of all backend actions, frontend telemetry, and test milestones.
3. **Telemetry Interception**: Puppeteer intercepts real-time logs (e.g., `[UI_ONLINE]`, `[UI_UPDATE]`) to confirm UI reflects backend state.
4. **Precision Screenshots**: Screenshots are captured **only** after the verification log is confirmed.
5. **Composite Reporting**: The `README.md` report integrates the execution trace, performance metrics, visual evidence, and a summarized PowerShell log report.

## 🛠️ Troubleshooting & Debugging

If a test fails, follow this triage order:

1. **Check `src/test_results.log`**: This is the "StepLogger" output. It shows the exact sequence of events from both Backend and Frontend.
2. **Check `src/test_error.log`**: Contains high-resolution stack traces for all browser console errors.
3. **Check `src/powershell.log`**: Use this to verify if the PowerShell script actually executed the commands or if it hit a WSL-level error.
4. **Common UI Failures**:
   - **`UI Online event not received`**: Likely a race condition where the instance was detected by the backend but the UI haven't received the WebSocket broadcast yet. Check the "Background Activity" log in the dashboard.
   - **`404 (Not Found)`**: Usually means the Bun dev server hasn't finished transpiling `app.ts` to `app.js`. Wait a few seconds or check the server console.

## ⚡ Live-Reload & Watch Mode

The dashboard now supports a high-fidelity **Live-Reload** environment:
- **`bun run dev`**: Launches the server in `--watch` mode.
- **Auto-Rebuild**: The server uses `fs.watch` to monitor `src/app.ts` and `src/style.css`. Any change triggers an automatic `bun build`.
- **WebSocket Sync**: The UI automatically attempts to reconnect if the server restarts during development.

## 📊 Automated Reporting

### Visual Verification
The test suite automatically captures full-page screenshots at every critical milestone:
- `screenshots/screenshot_initial.png`
- `screenshots/screenshot_after_add.png`
- `screenshots/screenshot_final.png`

### README Integration
On completion, `test.ts` appends/updates the `# Test Result` section in the root `README.md`. 
- **Performance Tables**: Reports total test time, instance creation time, and IO latency.
- **Error Summaries**: Aggregates all browser-side errors into a scannable table.
- **Direct Embedding**: Screenshots are embedded directly in the README for immediate visual confirmation of the build's health.
- **Composite Logs**: The README report automatically includes the last 30 lines of `src/powershell.log`, providing a complete backend-to-frontend execution trace.

## 🚀 How to Run Tests

1.  **Ensure Dashboard is Running**:
    ```powershell
    .\wsl_tools.ps1 dashboard
    ```
2.  **Execute Suite**:
    ```bash
    cd src
    bun run test.ts
    ```
3.  **Review Results**:
    Check the bottom of `README.md` or the `src/test_results.log` file.
