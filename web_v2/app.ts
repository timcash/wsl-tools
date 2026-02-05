/**
 * WSL Dashboard v2 - Premium Runtime
 */

const state = {
    instances: new Map<string, HTMLElement>(),
    ws: null as WebSocket | null,
};

// --- DOM References ---
const fleetGrid = document.getElementById('fleet-grid')!;

// --- Components (Vanilla Templates) ---

function createInstanceCard(inst: any) {
    const isRunning = inst.State === 'Running';
    const card = document.createElement('div');
    card.className = 'card glass animate-in';
    card.id = `card-${inst.Name}`;

    card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px;">
            <div>
                <h3 style="font-size: 18px; font-weight: 700; color: hsl(var(--fg-main));">${inst.Name}</h3>
                <div style="display: flex; gap: 8px; align-items: center; margin-top: 6px;">
                    <span class="badge ${isRunning ? 'badge-running' : ''}" style="background: ${isRunning ? '' : 'hsl(var(--bg-accent))'}; color: ${isRunning ? '' : 'hsl(var(--fg-dim))'}">
                        ${inst.State}
                    </span>
                    <span style="font-size: 11px; color: hsl(var(--fg-dim)); font-weight: 500;">Alpine Linux</span>
                </div>
            </div>
            <div style="display: flex; gap: 8px;">
                <button class="btn btn-ghost" style="padding: 8px;" onclick="window.app.start('${inst.Name}')" ${isRunning ? 'disabled' : ''}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                </button>
                <button class="btn btn-ghost" style="padding: 8px;" onclick="window.app.stop('${inst.Name}')" ${!isRunning ? 'disabled' : ''}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12"></rect></svg>
                </button>
            </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px;">
            <div class="glass" style="padding: 12px; border-radius: var(--radius-md); background: hsl(var(--bg-main) / 0.3);">
                <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: hsl(var(--fg-dim)); font-weight: 700; margin-bottom: 4px;">Memory</div>
                <div id="mem-${inst.Name}" style="font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums;">--</div>
            </div>
            <div class="glass" style="padding: 12px; border-radius: var(--radius-md); background: hsl(var(--bg-main) / 0.3);">
                <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: hsl(var(--fg-dim)); font-weight: 700; margin-bottom: 4px;">Storage</div>
                <div id="disk-${inst.Name}" style="font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums;">--</div>
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

function updateFleet(instances: any[]) {
    const currentNames = new Set(instances.map(i => i.Name));

    // Remove old
    for (const [name, el] of state.instances) {
        if (!currentNames.has(name)) {
            el.remove();
            state.instances.delete(name);
        }
    }

    // Update grid visibility
    if (instances.length > 0) {
        const loading = fleetGrid.querySelector('.card:not([id])');
        if (loading) loading.remove();
    }

    // Add or Refresh
    instances.forEach(inst => {
        let el = state.instances.get(inst.Name);
        if (!el) {
            el = createInstanceCard(inst);
            fleetGrid.appendChild(el);
            state.instances.set(inst.Name, el);
        } else {
            // Hot update status
            const badge = el.querySelector('.badge')!;
            const isRunning = inst.State === 'Running';
            badge.className = `badge ${isRunning ? 'badge-running' : ''}`;
            badge.textContent = inst.State;
            (badge as HTMLElement).style.background = isRunning ? '' : 'hsl(var(--bg-accent))';
            (badge as HTMLElement).style.color = isRunning ? '' : 'hsl(var(--fg-dim))';

            // Toggle buttons
            (el.querySelector('button[onclick*="start"]') as HTMLButtonElement).disabled = isRunning;
            (el.querySelector('button[onclick*="stop"]') as HTMLButtonElement).disabled = !isRunning;
        }
    });
}

function updateStats(stats: any) {
    const memEl = document.getElementById(`mem-${stats.InstanceName}`);
    const diskEl = document.getElementById(`disk-${stats.InstanceName}`);

    if (memEl) {
        const match = stats.Memory?.match(/Mem:\s+\d+\s+(\d+)/);
        memEl.textContent = match ? `${match[1]} MB` : '--';
    }
    if (diskEl) {
        const match = stats.Disk?.match(/\/\s+\d+\w+\s+(\d+\w+)/);
        diskEl.textContent = match ? match[1] : '--';
    }
}

// --- Global API ---
(window as any).app = {
    start: (name: string) => state.ws?.send(JSON.stringify({ type: 'start', name })),
    stop: (name: string) => state.ws?.send(JSON.stringify({ type: 'terminate', name })),
    copySsh: (name: string) => {
        navigator.clipboard.writeText(`wsl -d ${name}`);
        console.log("Copied SSH command for:", name);
    },
    add: () => {
        const input = document.getElementById('new-name') as HTMLInputElement;
        const name = input.value.trim();
        if (name) {
            state.ws?.send(JSON.stringify({ type: 'create', name }));
            input.value = "";
        }
    }
};

(window as any).addInstance = (window as any).app.add;

// Boot
connect();
