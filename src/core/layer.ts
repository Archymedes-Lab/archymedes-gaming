// ReliabilityLayer: the drop-in facade a game talks to. It wraps the studio's
// authoritative world with memory, grounding, bounded actions, verification and saves.
import { GameActionAPI } from './actions';
import { settle } from './contracts';
import { TieredRuntime, type DecisionContext, type ModelDecider } from './decide';
import { answer } from './answer';
import { groundFacts } from './grounding';
import { MemoryStore } from './memory';
import { NpcAgent, type Features, type Monitor, type NpcConfig, type Safeguards } from './npc';
import { decodeSnapshot, encodeSnapshot, InMemoryStorage, SNAPSHOT_VERSION, type Snapshot, type StorageAdapter } from './persistence';
import type { Answer, Question, Trace } from './types';
import { GameWorld } from './world';

/** Benchmark-only: switch safeguards off to measure what each one prevents. */
export type Ablation = Partial<Safeguards>;

export interface LayerConfig {
  seedWorld: () => GameWorld;
  npcs: NpcConfig[];
  model?: ModelDecider;
  modelBudgetMs?: number;
  useModel?: (ctx: DecisionContext) => boolean;
  storageKey?: string;
  traceLimit?: number;
  /** Called with every action about to execute, before its effects: plug external auditors here. */
  monitor?: Monitor;
  ablate?: Ablation;
  features?: Partial<Features>;
}

export type SessionStatus = 'fresh' | 'restored' | 'corrupt';

export const DEFAULT_STORAGE_KEY = 'archymedes.npc.session';

export class ReliabilityLayer {
  readonly api: GameActionAPI;
  readonly runtime: TieredRuntime;
  readonly ablation: Safeguards;
  readonly features: Features;
  private agents = new Map<string, NpcAgent>();
  private log = new Map<string, Trace[]>();

  private constructor(
    private cfg: LayerConfig,
    private storage: StorageAdapter,
    readonly world: GameWorld,
    snapshot?: Snapshot,
  ) {
    this.api = new GameActionAPI(world, Object.fromEntries(cfg.npcs.map((n) => [n.id, n.role])));
    if (snapshot?.cooldowns) this.api.restoreCooldowns(snapshot.cooldowns);
    this.ablation = { reconcile: true, verify: true, boundary: true, ...cfg.ablate };
    this.features = { proportionate: true, contracts: true, ...cfg.features }; // both adopted after passing pre-registered tests // adopted: passed P1–P3 (docs/NEXT-INNOVATION.md)
    this.runtime = new TieredRuntime({ model: cfg.model, modelBudgetMs: cfg.modelBudgetMs, useModel: cfg.useModel });
    for (const n of cfg.npcs) {
      const saved = snapshot?.agents[n.id];
      const memory = saved ? MemoryStore.fromJSON(saved.memory, n.memory) : new MemoryStore(n.id, n.memory);
      this.agents.set(n.id, new NpcAgent(n, memory, saved?.cursor ?? 0));
      this.log.set(n.id, []);
    }
  }

  static create(
    cfg: LayerConfig,
    storage: StorageAdapter = new InMemoryStorage(),
  ): { layer: ReliabilityLayer; status: SessionStatus; error?: string } {
    const decoded = decodeSnapshot(storage.getItem(cfg.storageKey ?? DEFAULT_STORAGE_KEY));
    if (decoded.status === 'restored') {
      try {
        const world = GameWorld.fromJSON(decoded.snapshot.world);
        return { layer: new ReliabilityLayer(cfg, storage, world, decoded.snapshot), status: 'restored' };
      } catch (e) {
        return { layer: new ReliabilityLayer(cfg, storage, cfg.seedWorld()), status: 'corrupt', error: String(e) };
      }
    }
    const layer = new ReliabilityLayer(cfg, storage, cfg.seedWorld());
    return decoded.status === 'corrupt' ? { layer, status: 'corrupt', error: decoded.error } : { layer, status: 'fresh' };
  }

  /** Advances the game one tick and runs every NPC once, in configuration order. */
  async tick(): Promise<Trace[]> {
    this.world.advance();
    if (this.features.contracts) settle(this.world); // engine-side, deterministic, before anyone decides
    const out: Trace[] = [];
    for (const agent of this.agents.values()) {
      const t = await agent.step(this.world, this.api, this.runtime, this.ablation, this.cfg.monitor, this.features);
      const log = this.log.get(agent.id)!;
      log.push(t);
      if (log.length > (this.cfg.traceLimit ?? 200)) log.shift();
      out.push(t);
    }
    return out;
  }

  ask(npcId: string, q: Question): Answer {
    const agent = this.agent(npcId);
    agent.perceive(this.world);
    agent.memory.reconcile(this.world);
    return answer(q, groundFacts(this.world, npcId, agent.config.knowledge), agent.memory, this.world);
  }

  memory(npcId: string): MemoryStore {
    return this.agent(npcId).memory;
  }

  config(npcId: string): NpcConfig {
    return this.agent(npcId).config;
  }

  npcIds(): string[] {
    return [...this.agents.keys()];
  }

  forget(npcId: string, memoryId: string): boolean {
    return this.agent(npcId).memory.forget(memoryId);
  }

  traces(npcId: string): readonly Trace[] {
    return this.log.get(npcId) ?? [];
  }

  setModel(model: ModelDecider | undefined): void {
    this.runtime.setModel(model);
  }

  snapshot(): Snapshot {
    return {
      version: SNAPSHOT_VERSION,
      world: this.world.toJSON(),
      agents: Object.fromEntries([...this.agents].map(([id, a]) => [id, { memory: a.memory.toJSON(), cursor: a.cursor }])),
      cooldowns: this.api.cooldownsJSON(),
    };
  }

  save(): void {
    this.storage.setItem(this.cfg.storageKey ?? DEFAULT_STORAGE_KEY, encodeSnapshot(this.snapshot()));
  }

  clearSave(): void {
    this.storage.removeItem(this.cfg.storageKey ?? DEFAULT_STORAGE_KEY);
  }

  private agent(id: string): NpcAgent {
    const a = this.agents.get(id);
    if (!a) throw new Error(`unknown npc ${id}`);
    return a;
  }
}
