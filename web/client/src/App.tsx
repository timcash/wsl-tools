import { useState, useEffect, useCallback } from 'react'
import { Plus, Play, Square, Terminal, Monitor, Server, Cpu, HardDrive } from 'lucide-react'
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"

interface WSLInstance {
    Name: string;
    State: string;
    Memory?: string;
    Disk?: string;
}

interface WSMessage {
    type: 'list' | 'stats' | 'create' | 'start' | 'terminate';
    data?: any;
    name?: string;
}

export default function App() {
    const [instances, setInstances] = useState<WSLInstance[]>([]);
    const [newInstanceName, setNewInstanceName] = useState('');
    const [ws, setWs] = useState<WebSocket | null>(null);

    // --- WebSocket Connection ---
    useEffect(() => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);

        socket.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.type === 'list') {
                setInstances(msg.data);
            } else if (msg.type === 'stats') {
                setInstances(prev => prev.map(inst =>
                    inst.Name === msg.data.InstanceName
                        ? { ...inst, Memory: msg.data.Memory, Disk: msg.data.Disk }
                        : inst
                ));
            }
        };

        socket.onclose = () => {
            console.log('WS Disconnected');
            setWs(null);
        };

        setWs(socket);
        return () => socket.close();
    }, []);

    // --- Handlers ---
    const startInstance = useCallback((name: string) => {
        ws?.send(JSON.stringify({ type: 'start', name }));
    }, [ws]);

    const stopInstance = useCallback((name: string) => {
        ws?.send(JSON.stringify({ type: 'terminate', name }));
    }, [ws]);

    const createInstance = useCallback(() => {
        if (!newInstanceName.trim()) return;
        ws?.send(JSON.stringify({ type: 'create', name: newInstanceName.trim() }));
        setNewInstanceName('');
    }, [ws, newInstanceName]);

    return (
        <div className="min-h-screen bg-neutral-950 text-neutral-50 flex flex-col">
            {/* Header */}
            <header className="border-b border-neutral-800 bg-neutral-900/50 backdrop-blur-md sticky top-0 z-10">
                <div className="container mx-auto h-16 px-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="bg-primary h-8 w-8 rounded-md flex items-center justify-center text-primary-foreground shadow-lg shadow-primary/20">
                            <Monitor className="h-5 w-5" />
                        </div>
                        <div>
                            <h1 className="text-lg font-bold tracking-tight leading-none">WSL Manager</h1>
                            <p className="text-[10px] text-neutral-500 uppercase tracking-widest font-semibold mt-1">Fleet Orchestrator</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <Input
                            placeholder="New instance name..."
                            value={newInstanceName}
                            onChange={(e) => setNewInstanceName(e.target.value)}
                            className="w-48 bg-neutral-900 border-neutral-800 h-9"
                            onKeyPress={(e) => e.key === 'Enter' && createInstance()}
                        />
                        <Button size="sm" onClick={createInstance}>
                            <Plus className="h-4 w-4 mr-2" />
                            Add
                        </Button>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="flex-grow container mx-auto p-6 md:p-8">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {instances.map((inst) => (
                        <Card key={inst.Name} className="bg-neutral-900 border-neutral-800 hover:border-neutral-700 transition-all group">
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <div className="space-y-1">
                                    <CardTitle className="text-base font-bold tracking-tight">{inst.Name}</CardTitle>
                                    <Badge variant={inst.State === 'Running' ? 'default' : 'secondary'} className="h-5 px-1.5 text-[10px] uppercase font-bold tracking-wider">
                                        {inst.State}
                                    </Badge>
                                </div>
                                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    {inst.State !== 'Running' ? (
                                        <Button size="icon" variant="ghost" className="h-8 w-8 text-neutral-400 hover:text-white" onClick={() => startInstance(inst.Name)}>
                                            <Play className="h-4 w-4" />
                                        </Button>
                                    ) : (
                                        <Button size="icon" variant="ghost" className="h-8 w-8 text-red-400 hover:text-red-300 hover:bg-red-950/30" onClick={() => stopInstance(inst.Name)}>
                                            <Square className="h-4 w-4" />
                                        </Button>
                                    )}
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-4 pt-2">
                                    {/* Quick Info */}
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1">
                                            <p className="text-[10px] text-neutral-500 font-bold uppercase tracking-wider flex items-center gap-1">
                                                <Cpu className="h-3 w-3" /> CPU / RAM
                                            </p>
                                            <p className="text-sm font-medium tabular-nums text-neutral-300">
                                                {inst.Memory ? inst.Memory.match(/Mem:\s+\d+\s+(\d+)/)?.[1] + ' MB' : '--'}
                                            </p>
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-[10px] text-neutral-500 font-bold uppercase tracking-wider flex items-center gap-1">
                                                <HardDrive className="h-3 w-3" /> Storage
                                            </p>
                                            <p className="text-sm font-medium tabular-nums text-neutral-300">
                                                {inst.Disk ? inst.Disk.match(/\/\s+\d+\w+\s+(\d+\w+)/)?.[1] : '--'}
                                            </p>
                                        </div>
                                    </div>

                                    {/* SSH Command */}
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <p className="text-[10px] text-neutral-500 font-bold uppercase tracking-wider">Terminal Access</p>
                                            <Button
                                                variant="ghost"
                                                className="h-4 px-1 text-[10px] text-primary hover:bg-transparent"
                                                onClick={() => {
                                                    navigator.clipboard.writeText(`wsl -d ${inst.Name}`);
                                                }}
                                            >
                                                Copy Command
                                            </Button>
                                        </div>
                                        <div className="bg-neutral-950 border border-neutral-800 rounded px-3 py-2 flex items-center gap-2 group/term">
                                            <Terminal className="h-3 w-3 text-neutral-600" />
                                            <code className="text-xs font-mono text-neutral-400 truncate flex-grow">
                                                wsl -d {inst.Name}
                                            </code>
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}

                    {instances.length === 0 && (
                        <div className="col-span-full py-20 flex flex-col items-center justify-center text-neutral-600 border-2 border-dashed border-neutral-900 rounded-xl">
                            <Server className="h-10 w-10 mb-4 opacity-20" />
                            <p className="text-sm font-medium">No instances found on this fleet.</p>
                            <p className="text-xs mt-1">Add a new instance above to get started.</p>
                        </div>
                    )}
                </div>
            </main>

            <footer className="border-t border-neutral-900 p-4 text-center">
                <p className="text-[10px] text-neutral-600 uppercase tracking-[0.3em] font-bold">
                    Bun Architecture &bull; Shadcn &bull; Radix Engine
                </p>
            </footer>
        </div>
    )
}
