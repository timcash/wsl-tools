import './styles.css';

/**
 * WSL Dashboard App - Vanilla Reactivity
 */

const state = {
    instances: new Map(),
    ws: null,
};

// --- DOM References ---
const grid = document.getElementById('instance-grid');
const addBtn = document.getElementById('add-instance-btn');
const newInstanceInput = document.getElementById('new-instance-name');

// --- Components ---

function createInstanceCard(inst) {
    const isRunning = inst.State === 'Running';
    const card = document.createElement('div');
    card.className = 'glass-card p-6 flex flex-col gap-4 animate-in fade-in zoom-in duration-300';
    card.id = `card-${inst.Name}`;

    card.innerHTML = `
        <div class="flex justify-between items-start">
            <div>
                <h3 class="text-lg font-semibold tracking-tight">${inst.Name}</h3>
                <span class="badge ${isRunning ? 'badge-running' : 'badge-stopped'} mt-1">
                    ${inst.State}
                </span>
            </div>
            <div class="flex gap-2">
                <button class="btn-secondary text-xs" onclick="window.app.startInstance('${inst.Name}')" ${isRunning ? 'disabled' : ''}>Start</button>
                <button class="btn-secondary text-xs text-destructive hover:bg-destructive/10" onclick="window.app.stopInstance('${inst.Name}')" ${!isRunning ? 'disabled' : ''}>Stop</button>
            </div>
        </div>
        
        <div class="flex flex-col gap-2">
            <label class="text-xs text-muted-foreground uppercase tracking-wider font-bold">SSH Command</label>
            <div class="flex gap-2">
                <input type="text" class="input-field flex-grow text-xs font-mono" value="wsl -d ${inst.Name}" readonly>
                <button class="btn-secondary text-xs" onclick="window.app.copySsh('${inst.Name}')">Copy</button>
            </div>
        </div>

        <div id="stats-${inst.Name}" class="grid grid-cols-2 gap-4 mt-2 ${!isRunning ? 'opacity-30' : ''}">
            <div class="flex flex-col">
                <span class="text-[10px] text-muted-foreground uppercase font-bold">Memory</span>
                <span class="text-sm font-medium stats-mem">--</span>
            </div>
            <div class="flex flex-col">
                <span class="text-[10px] text-muted-foreground uppercase font-bold">Storage</span>
                <span class="text-sm font-medium stats-disk">--</span>
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
            updateList(msg.data);
        } else if (msg.type === 'stats') {
            updateStats(msg.data);
        }
    };

    state.ws.onclose = () => {
        console.log('WS Disconnected. Retrying...');
        setTimeout(connect, 2000);
    };
}

function updateList(instances) {
    // Basic reconciliation
    const currentNames = new Set(instances.map(i => i.Name));

    // Remove old
    for (const [name, el] of state.instances) {
        if (!currentNames.has(name)) {
            el.remove();
            state.instances.delete(name);
        }
    }

    // Add or Update
    instances.forEach(inst => {
        let el = state.instances.get(inst.Name);
        if (!el) {
            el = createInstanceCard(inst);
            grid.appendChild(el);
            state.instances.set(inst.Name, el);
        } else {
            // Update status badge
            const badge = el.querySelector('.badge');
            const isRunning = inst.State === 'Running';
            badge.className = `badge ${isRunning ? 'badge-running' : 'badge-stopped'} mt-1`;
            badge.textContent = inst.State;

            // Update button states
            el.querySelector('button[onclick*="startInstance"]').disabled = isRunning;
            el.querySelector('button[onclick*="stopInstance"]').disabled = !isRunning;
            el.querySelector(`#stats-${inst.Name}`).classList.toggle('opacity-30', !isRunning);
        }
    });
}

function updateStats(stats) {
    const el = state.instances.get(stats.InstanceName);
    if (!el) return;

    // Very basic parse of 'free -m' and 'df -h' strings for demo
    // In real use, server should return pre-parsed JSON numbers
    const memMatch = stats.Memory?.match(/Mem:\s+\d+\s+(\d+)/);
    const diskMatch = stats.Disk?.match(/\/\s+\d+\w+\s+(\d+\w+)/);

    if (memMatch) el.querySelector('.stats-mem').textContent = `${memMatch[1]} MB`;
    if (diskMatch) el.querySelector('.stats-disk').textContent = diskMatch[1];
}

// --- Public API for Buttons ---
window.app = {
    startInstance: (name) => state.ws.send(JSON.stringify({ type: 'start', name })),
    stopInstance: (name) => state.ws.send(JSON.stringify({ type: 'terminate', name })),
    copySsh: (name) => {
        const input = state.instances.get(name).querySelector('input');
        input.select();
        document.execCommand('copy');
    },
    createInstance: () => {
        const name = newInstanceInput.value.trim();
        if (name) {
            state.ws.send(JSON.stringify({ type: 'create', name }));
            newInstanceInput.value = '';
        }
    }
};

addBtn.onclick = window.app.createInstance;
newInstanceInput.onkeypress = (e) => { if (e.key === 'Enter') window.app.createInstance(); };

// Start
connect();
