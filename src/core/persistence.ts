// Versioned session snapshots behind a storage adapter (in-memory for tests,
// localStorage in the browser, a game save slot or backend in production).
import type { MemoryJSON } from './memory';
import type { WorldJSON } from './world';

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class InMemoryStorage implements StorageAdapter {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

export const SNAPSHOT_VERSION = 1 as const;

export interface AgentJSON {
  memory: MemoryJSON;
  cursor: number; // number of world events already perceived
}

export interface Snapshot {
  version: typeof SNAPSHOT_VERSION;
  world: WorldJSON;
  agents: Record<string, AgentJSON>;
  cooldowns?: Record<string, number>;
}

export type Decoded =
  | { status: 'fresh' }
  | { status: 'restored'; snapshot: Snapshot }
  | { status: 'corrupt'; error: string };

export function encodeSnapshot(s: Snapshot): string {
  return JSON.stringify(s);
}

export function decodeSnapshot(raw: string | null): Decoded {
  if (raw === null) return { status: 'fresh' };
  try {
    const s = JSON.parse(raw) as Partial<Snapshot>;
    if (!s || s.version !== SNAPSHOT_VERSION) return { status: 'corrupt', error: `unsupported version ${String(s?.version)}` };
    if (!s.world || typeof s.world !== 'object' || !s.agents || typeof s.agents !== 'object')
      return { status: 'corrupt', error: 'missing world or agents' };
    return { status: 'restored', snapshot: s as Snapshot };
  } catch (e) {
    return { status: 'corrupt', error: e instanceof Error ? e.message : String(e) };
  }
}
