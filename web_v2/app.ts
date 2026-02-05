/**
 * WSL Dashboard v2 - Premium Runtime
 */

const state = {
    instances: new Map<string, HTMLElement>(),
    // Keep track of instances in transition to prevent premature removal
    transitions: new Map<string, { state: string, stamp: number }>(),
    ws: null as WebSocket | null,
};

const GRACE_PERIOD_MS = 15000; // 15 seconds for WSL operations

// --- DOM References ---
const fleetGrid = document.getElementById('fleet-grid')!;

// --- Components (Vanilla Templates) ---

function createInstanceCard(inst: any) {
    const isRunning = inst.State === 'Running';
    const isTransitioning = ['Creating', 'Starting', 'Stopping'].includes(inst.State);
    const card = document.createElement('div');
    card.className = `card glass animate-in ${isTransitioning ? 'pulse' : ''}`;
    card.id = `card-${inst.Name}`;

    card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px;">
            <div>
                <h3 style="font-size: 18px; font-weight: 700; color: hsl(var(--fg-main));">${inst.Name}</h3>
                <div style="display: flex; gap: 8px; align-items: center; margin-top: 6px;">
                    <span class="badge ${isRunning ? 'badge-running' : (isTransitioning ? 'badge-transition' : '')}" 
                          style="background: ${isRunning || isTransitioning ? '' : 'hsl(var(--bg-accent))'}; 
                                 color: ${isRunning || isTransitioning ? '' : 'hsl(var(--fg-dim))'}">
                        ${inst.State}
                    </span>
                    <span style="font-size: 11px; color: hsl(var(--fg-dim)); font-weight: 500;">Alpine Linux</span>
                </div>
            </div>
            <div style="display: flex; gap: 8px;">
                <button class="btn btn-ghost" style="padding: 8px;" onclick="window.app.start('${inst.Name}')" ${isRunning || isTransitioning ? 'disabled' : ''}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                </button>
                <button class="btn btn-ghost" style="padding: 8px;" onclick="window.app.stop('${inst.Name}')" ${!isRunning || isTransitioning ? 'disabled' : ''}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12"></rect></svg>
                </button>
            </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px;">
            <div class="glass" style="padding: 12px; border-radius: var(--radius-md); background: hsl(var(--bg-main) / 0.3);">
                <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: hsl(var(--fg-dim)); font-weight: 700; margin-bottom: 4px;">Memory</div>
                <div id="mem-${inst.Name}" style="font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums;">${inst.Memory || '--'}</div>
            </div>
            <div class="glass" style="padding: 12px; border-radius: var(--radius-md); background: hsl(var(--bg-main) / 0.3);">
                <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: hsl(var(--fg-dim)); font-weight: 700; margin-bottom: 4px;">Storage</div>
                <div id="disk-${inst.Name}" style="font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums;">${inst.Disk || '--'}</div>
            </div>
        </div>

        <div style="position: relative;">
            <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: hsl(var(--fg-dim)); font-weight: 700; margin-bottom: 8px; display: flex; justify-content: space-between;">
                <span>Terminal Access</span>
                <span style="cursor: pointer; color: hsl(var(--primary));" onclick="window.app.copySsh('${inst.Name}')">Copy</span>
            </div>
            <div class="glass" style="padding: 10px 14px; border-radius: var(--radius-md); font-family: monospace; font-size: 12px; color: hsl(var(--fg-muted)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                wsl -d ${inst.Name}
            </div>
        </div>
    `;

    return card;
}

// --- App Logic ---

function connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    state.ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    state.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'list') {
            updateFleet(msg.data);
        } else if (msg.type === 'stats') {
            updateStats(msg.data);
        }
    };

    state.ws.onclose = () => {
        console.log("[WS] Disconnected. Reconnecting...");
        setTimeout(connect, 2000);
    };
}

function ensurePlaceholder(name: string, stateLabel: string) {
    // Record transition
    state.transitions.set(name, { state: stateLabel, stamp: Date.now() });

    let el = state.instances.get(name);
    if (!el) {
        // Initial setup for the placeholder
        const placeholder = { Name: name, State: stateLabel, Memory: '--', Disk: '--' };
        el = createInstanceCard(placeholder);

        // Remove loading state if present
        const loading = fleetGrid.querySelector('.card:not([id])');
        if (loading) loading.remove();

        fleetGrid.appendChild(el);
        state.instances.set(name, el);
    } else {
        // Update existing element to transition state
        el.className = 'card glass animate-in pulse';
        const badge = el.querySelector('.badge')!;
        badge.className = 'badge badge-transition';
        badge.textContent = stateLabel;
        (badge as HTMLElement).style.background = '';
        (badge as HTMLElement).style.color = '';

        // Disable buttons
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
            // If we are "Creating", don't remove unless grace period expired
            if (trans && trans.state === 'Creating' && (now - trans.stamp < GRACE_PERIOD_MS)) {
                continue;
            }

            el.remove();
            state.instances.delete(name);
            state.transitions.delete(name);
        }
    }

    // Grid visibility
    if (instances.length > 0 || state.transitions.size > 0) {
        const loading = fleetGrid.querySelector('.card:not([id])');
        if (loading) loading.remove();
    }

    // 3. Add or Refresh
    instances.forEach(inst => {
        const trans = state.transitions.get(inst.Name);
        let el = state.instances.get(inst.Name);

        // If we are in transition, don't let stale server list overwrite UI
        const displayState = trans ? trans.state : inst.State;
        const isRunning = displayState === 'Running';
        const isTransitioning = ['Creating', 'Starting', 'Stopping'].includes(displayState);

        if (!el) {
            el = createInstanceCard({ ...inst, State: displayState });
            fleetGrid.appendChild(el);
            state.instances.set(inst.Name, el);
        } else {
            // Update status & visuals
            el.className = `card glass animate-in ${isTransitioning ? 'pulse' : ''}`;
            const currentBadge = el.querySelector('.badge')!;
            currentBadge.className = `badge ${isRunning ? 'badge-running' : (isTransitioning ? 'badge-transition' : '')}`;
            currentBadge.textContent = displayState;
            (currentBadge as HTMLElement).style.background = isRunning || isTransitioning ? '' : 'hsl(var(--bg-accent))';
            (currentBadge as HTMLElement).style.color = isRunning || isTransitioning ? '' : 'hsl(var(--fg-dim))';

            // Toggle buttons
            (el.querySelector('button[onclick*="start"]') as HTMLButtonElement).disabled = isRunning || isTransitioning;
            (el.querySelector('button[onclick*="stop"]') as HTMLButtonElement).disabled = !isRunning || isTransitioning;
        }
    });
}

function updateStats(stats: any) {
    const memEl = document.getElementById(`mem-${stats.InstanceName}`);
    const diskEl = document.getElementById(`disk-${stats.InstanceName}`);

    if (memEl && stats.Memory) {
        const parts = stats.Memory.split(/\s+/);
        const memIdx = parts.indexOf('Mem:');
        if (memIdx !== -1 && parts[memIdx + 2]) {
            memEl.textContent = `${parts[memIdx + 2]} MB`;
        }
    }

    if (diskEl && stats.Disk) {
        const lines = stats.Disk.trim().split('\n');
        const rootLine = lines.find((l: string) => l.endsWith(' /'));
        if (rootLine) {
            const parts = rootLine.split(/\s+/);
            if (parts[2]) diskEl.textContent = parts[2];
        } else {
            const match = stats.Disk.match(/\/\s+\d+\w+\s+(\d+\w+)/);
            if (match) diskEl.textContent = match[1];
        }
    }
}

// --- Global API ---
(window as any).app = {
    start: (name: string) => {
        ensurePlaceholder(name, 'Starting');
        state.ws?.send(JSON.stringify({ type: 'start', name }));
    },
    stop: (name: string) => {
        ensurePlaceholder(name, 'Stopping');
        state.ws?.send(JSON.stringify({ type: 'terminate', name }));
    },
    copySsh: (name: string) => {
        navigator.clipboard.writeText(`wsl -d ${name}`);
        console.log("Copied SSH command for:", name);
    },
    add: () => {
        const input = document.getElementById('new-name') as HTMLInputElement;
        const name = input.value.trim();
        if (name) {
            ensurePlaceholder(name, 'Creating');
            state.ws?.send(JSON.stringify({ type: 'create', name }));
            input.value = "";
        }
    }
};

(window as any).addInstance = (window as any).app.add;

// Boot
connect();
