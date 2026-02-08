/**
 * WSL Dashboard v2
 */

const state = {
    instances: new Map<string, HTMLElement>(),
    // Keep track of instances in transition to prevent premature removal
    transitions: new Map<string, { state: string, stamp: number }>(),
    ws: null as WebSocket | null,
};

const GRACE_PERIOD_MS = 120000; // 120 seconds for WSL operations

// --- DOM References ---
const fleetGrid = document.getElementById('fleet-grid')!;

// --- Components (Vanilla Templates) ---

function createInstanceCard(inst: any) {
    const isRunning = inst.State === 'Running';
    const isTransitioning = ['Creating', 'Starting', 'Stopping', 'Deleting'].includes(inst.State);
    const row = document.createElement('tr');
    row.className = `fleet-table-row animate-in ${isTransitioning ? 'pulse' : ''}`;
    row.id = `card-${inst.Name}`;

    row.innerHTML = `
        <td style="padding: 12px 24px; font-size: 14px; font-weight: 600; color: hsl(var(--fg-main)); width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${inst.Name}
        </td>
        <td style="padding: 12px 24px;">
            <span class="badge ${isRunning ? 'badge-running' : (isTransitioning ? 'badge-transition' : '')}" 
                  style="padding: 2px 8px; font-size: 9px; white-space: nowrap;">
                ${inst.State}
            </span>
        </td>
        <td id="mem-${inst.Name}" style="padding: 12px 24px; font-family: monospace; font-size: 12px; color: hsl(var(--fg-muted));">
            ${inst.Memory || '--'}
        </td>
        <td id="disk-${inst.Name}" style="padding: 12px 24px; font-family: monospace; font-size: 12px; color: hsl(var(--fg-muted));">
            ${inst.Disk || '--'}
        </td>
        <td style="padding: 12px 24px; text-align: right;">
            <div style="display: flex; gap: 4px; justify-content: flex-end; align-items: center;">
                <button class="btn btn-ghost btn-sm" aria-label="Copy ${inst.Name}" title="Copy Command" onclick="window.app.copySsh('${inst.Name}')">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                </button>
                <button class="btn btn-ghost btn-sm" aria-label="Start ${inst.Name}" onclick="window.app.start('${inst.Name}')" ${isRunning || isTransitioning ? 'disabled' : ''}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                </button>
                <button class="btn btn-ghost btn-sm" aria-label="Stop ${inst.Name}" onclick="window.app.stop('${inst.Name}')" ${!isRunning || isTransitioning ? 'disabled' : ''}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12"></rect></svg>
                </button>
                <button class="btn btn-ghost btn-sm" style="color: hsl(0, 70%, 60%);" aria-label="Delete ${inst.Name}" onclick="window.app.delete('${inst.Name}')" ${isTransitioning ? 'disabled' : ''}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            </div>
        </td>
    `;

    return row;
}

// --- App Logic ---

function connect() {
    console.log("[WS] Attempting connection...");
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    state.ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    state.ws.onopen = () => {
        console.log("[WS] Connected to backend");
    };

    state.ws.onmessage = (event) => {
        if (!event.data) {
            console.warn("[WS] Received empty message");
            return;
        }

        try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'list') {
                updateFleet(msg.data);
            } else if (msg.type === 'stats') {
                updateStats(msg.data);
            } else if (msg.type === 'ps-log') {
                appendPsLog(msg.data);
            }
        } catch (e) {
            console.error("[WS] Failed to parse message:", e, "Raw data:", event.data);
        }
    };

    state.ws.onclose = () => {
        console.log("[WS] Disconnected. Reconnecting...");
        setTimeout(connect, 2000);
    };

    state.ws.onerror = (err) => {
        console.error("[WS] Error:", err);
    };
}

function appendPsLog(text: string) {
    const logContainer = document.getElementById('ps-logs');
    if (!logContainer) return;

    if (logContainer.querySelector('div[style*="italic"]')) {
        logContainer.innerHTML = '';
    }

    const entry = document.createElement('div');
    entry.style.borderLeft = '2px solid hsl(var(--accent) / 0.3)';
    entry.style.paddingLeft = '8px';
    entry.style.lineHeight = '1.4';

    if (text.includes('[ERROR]') || text.includes('FAILED')) {
        entry.style.color = 'hsl(350, 80%, 60%)';
    } else if (text.includes('[INFO]')) {
        entry.style.color = 'hsl(var(--fg-muted))';
    } else if (text.includes('[DEBUG]')) {
        entry.style.color = 'hsl(var(--fg-dim))';
        entry.style.fontSize = '12px';
    } else {
        entry.style.color = 'hsl(var(--fg-muted))';
    }

    const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    entry.textContent = `[${time}] ${text}`;

    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;

    while (logContainer.childNodes.length > 100) {
        logContainer.removeChild(logContainer.firstChild!);
    }
}

function ensurePlaceholder(name: string, stateLabel: string) {
    console.log(`[UI_DISCOVERY] Ensuring placeholder for: ${name} (${stateLabel})`);
    state.transitions.set(name, { state: stateLabel, stamp: Date.now() });

    let el = state.instances.get(name);
    if (!el) {
        const placeholder = { Name: name, State: stateLabel, Memory: '--', Disk: '--' };
        el = createInstanceCard(placeholder);
        const loading = document.getElementById('loading-row');
        if (loading) loading.remove();
        fleetGrid.appendChild(el);
        state.instances.set(name, el);
    } else {
        el.className = 'animate-in pulse';
        const badge = el.querySelector('.badge')!;
        badge.className = 'badge badge-transition';
        badge.textContent = stateLabel;
        (badge as HTMLElement).style.background = '';
        (badge as HTMLElement).style.color = '';
        Array.from(el.querySelectorAll('button')).forEach(btn => (btn as HTMLButtonElement).disabled = true);
    }
}

function updateFleet(instances: any[]) {
    const now = Date.now();
    const currentNames = new Set(instances.map(i => i.Name));

    // 1. Reconcile Transitions
    instances.forEach(inst => {
        const trans = state.transitions.get(inst.Name);
        if (trans) {
            // If server now matches or has advanced, clear bridge
            if (inst.State === 'Running' || (trans.state === 'Stopping' && inst.State === 'Stopped')) {
                state.transitions.delete(inst.Name);
            }
        }
    });

    // 2. Removal Logic with Grace Period
    for (const [name, el] of state.instances) {
        if (!currentNames.has(name)) {
            const trans = state.transitions.get(name);
            
            // IF we were deleting it, and it's gone from server, success!
            if (trans?.state === 'Deleting') {
                console.log(`[UI_DELETED] Instance removed: ${name}`);
                el.remove();
                state.instances.delete(name);
                state.transitions.delete(name);
                continue;
            }

            // If we are in a transition period, don't remove unless grace period expired
            if (trans && (now - trans.stamp < GRACE_PERIOD_MS)) {
                continue;
            }

            el.remove();
            state.instances.delete(name);
            state.transitions.delete(name);
        }
    }

    if (instances.length > 0 || state.transitions.size > 0) {
        const loading = document.getElementById('loading-row');
        if (loading) loading.remove();
    }

    instances.forEach(inst => {
        const trans = state.transitions.get(inst.Name);
        let el = state.instances.get(inst.Name);
        const displayState = trans ? trans.state : inst.State;
        const isRunning = displayState === 'Running';
        const isTransitioning = ['Creating', 'Starting', 'Stopping'].includes(displayState);

        if (!el) {
            el = createInstanceCard({ ...inst, State: displayState });
            if (displayState === 'Running') console.log(`[UI_ONLINE] Instance online: ${inst.Name}`);
            fleetGrid.appendChild(el);
            state.instances.set(inst.Name, el);
        } else {
            el.className = `animate-in ${isTransitioning ? 'pulse' : ''}`;
            const currentBadge = el.querySelector('.badge')!;
            
            if (displayState === 'Running' && currentBadge.textContent !== 'Running') {
                console.log(`[UI_ONLINE] Instance online: ${inst.Name}`);
            }
            currentBadge.className = `badge ${isRunning ? 'badge-running' : (isTransitioning ? 'badge-transition' : '')}`;
            if (displayState === 'Stopped' && currentBadge.textContent !== 'Stopped') {
                console.log(`[UI_STOPPED] Instance stopped: ${inst.Name}`);
            }
            currentBadge.textContent = displayState;
            (currentBadge as HTMLElement).style.background = isRunning || isTransitioning ? '' : 'hsl(var(--bg-accent))';
            (currentBadge as HTMLElement).style.color = isRunning || isTransitioning ? '' : 'hsl(var(--fg-dim))';
            (el.querySelector('button[onclick*="start"]') as HTMLButtonElement).disabled = isRunning || isTransitioning;
            (el.querySelector('button[onclick*="stop"]') as HTMLButtonElement).disabled = !isRunning || isTransitioning;
        }
    });
}

function updateStats(stats: any) {
    const memEl = document.getElementById(`mem-${stats.InstanceName}`);
    const diskEl = document.getElementById(`disk-${stats.InstanceName}`);

    if (memEl) {
        const oldVal = memEl.textContent;
        if (oldVal !== stats.Memory) {
            console.log(`[UI_UPDATE] Stats updated: ${stats.InstanceName} Mem: ${stats.Memory || '--'}`);
            memEl.textContent = stats.Memory || '--';
        }
    }
    if (diskEl) {
        const oldVal = diskEl.textContent;
        if (oldVal !== stats.Disk) {
            // Only log if we didn't already log for Mem
            if (!memEl || memEl.textContent === stats.Memory) {
                 console.log(`[UI_UPDATE] Stats updated: ${stats.InstanceName} Disk: ${stats.Disk || '--'}`);
            }
            diskEl.textContent = stats.Disk || '--';
        }
    }
}

(window as any).app = {
    start: (name: string) => {
        ensurePlaceholder(name, 'Starting');
        state.ws?.send(JSON.stringify({ type: 'start', name }));
    },
    stop: (name: string) => {
        ensurePlaceholder(name, 'Stopping');
        state.ws?.send(JSON.stringify({ type: 'terminate', name }));
    },
    delete: (name: string) => {
        if (confirm(`Are you sure you want to delete ${name}?`)) {
            console.log(`[UI_ACTION] Delete requested for: ${name}`);
            if (confirm(`Are you sure you want to delete ${name}?`)) {
                console.log(`[UI_ACTION] Confirmed delete for: ${name}. Sending WS message.`);
                ensurePlaceholder(name, 'Deleting');
                state.ws?.send(JSON.stringify({ type: 'delete', name }));
            } else {
                console.log(`[UI_ACTION] Delete cancelled for: ${name}`);
            }
        }
    },
    copySsh: (name: string) => {
        navigator.clipboard.writeText(`wsl -d ${name}`);
        console.log("Copied SSH command for:", name);
    },
    add: () => {
        const input = document.getElementById('new-name') as HTMLInputElement;
        const name = input.value.trim();
        console.log(`[UI_ACTION] Add requested for: ${name}`);
        if (name) {
            if (state.ws?.readyState === WebSocket.OPEN) {
                console.log(`[UI_ACTION] Sending create message for: ${name}`);
                ensurePlaceholder(name, 'Creating');
                state.ws?.send(JSON.stringify({ type: 'create', name }));
                input.value = "";
            } else {
                console.error(`[UI_ACTION] Cannot send: WebSocket state is ${state.ws?.readyState}`);
            }
        }
    }
};

(window as any).addInstance = (window as any).app.add;
connect();
