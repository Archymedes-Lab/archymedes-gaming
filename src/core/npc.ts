// One NPC's perceive → remember → reconcile → decide → verify → act loop.
// Produces a Trace for every tick so behaviour can be inspected and replayed.
import type { GameActionAPI } from './actions';
import { idle, type TieredRuntime } from './decide';
import { groundFacts } from './grounding';
import type { MemoryStore } from './memory';
import type { ActionProposal, FactSet, KnowledgePolicy, MemoryPolicy, RoleSpec, Trace, Validation } from './types';
import { verify } from './verify';
import type { GameWorld } from './world';

export interface NpcConfig {
  id: string;
  role: RoleSpec;
  memory: MemoryPolicy;
  knowledge: KnowledgePolicy;
}

/** Which safeguards run. All on in production; switched off only to measure what each one buys. */
export interface Safeguards {
  reconcile: boolean;
  verify: boolean;
  boundary: boolean;
}

/** Mechanisms adopted after their pre-registered prototype tests (docs/NEXT-INNOVATION.md). */
export interface Features {
  proportionate: boolean;
  contracts: boolean;
}

export type Monitor = (executed: ActionProposal, world: GameWorld, memory: MemoryStore) => void;

const PASS: Validation = { ok: true, violations: [] };

export class NpcAgent {
  constructor(
    readonly config: NpcConfig,
    readonly memory: MemoryStore,
    public cursor = 0,
  ) {}

  get id(): string {
    return this.config.id;
  }

  /** Forms memories from game events not yet perceived. */
  perceive(world: GameWorld): string[] {
    const self = world.getEntity(this.id);
    const events = world.events();
    const formed: string[] = [];
    for (; this.cursor < events.length; this.cursor++) {
      const m = self ? this.memory.observe(events[this.cursor]!, self.pos) : null;
      if (m) formed.push(m.id);
    }
    return formed;
  }

  focus(world: GameWorld): string | null {
    const self = world.getEntity(this.id);
    if (!self) return null;
    let best: { id: string; d: number } | null = null;
    for (const e of world.entities()) {
      if (e.kind !== 'player') continue;
      const d = Math.hypot(e.pos.x - self.pos.x, e.pos.z - self.pos.z);
      if (d <= this.config.knowledge.perceptionRadius && (!best || d < best.d || (d === best.d && e.id < best.id)))
        best = { id: e.id, d };
    }
    return best?.id ?? null;
  }

  async step(
    world: GameWorld,
    api: GameActionAPI,
    runtime: TieredRuntime,
    guard: Safeguards = { reconcile: true, verify: true, boundary: true },
    monitor?: Monitor,
    features: Features = { proportionate: true, contracts: true },
  ): Promise<Trace> {
    const newMemories = this.perceive(world);
    const corrected = guard.reconcile ? this.memory.reconcile(world) : [];
    const forgotten = this.memory.decayTo(world.tick);
    const focus = this.focus(world);
    const facts = groundFacts(world, this.id, this.config.knowledge);
    const ctx = { npcId: this.id, role: this.config.role, tick: world.tick, facts, memory: this.memory, focus, proportionate: features.proportionate, contracts: features.contracts };
    const check = (p: ActionProposal, f: FactSet) => {
      const validation = guard.boundary ? api.validate(p) : PASS;
      const v = verify(p, f, this.memory, validation, { proportionate: features.proportionate });
      // with the verifier ablated only the engine's verdict counts
      return guard.verify ? v : { ...v, grounded: true, consistent: true, proportionate: true, ok: validation.ok };
    };

    const decision = await runtime.decide(ctx, (p) => check(p, facts), world.getEntity(this.id)?.pos);

    // Re-check against current state: the world may have moved while a model was thinking.
    const freshFacts = groundFacts(world, this.id, this.config.knowledge);
    let executed = decision.proposal;
    let verdict = check(executed, freshFacts);
    if (!verdict.ok) {
      executed = idle(this.id, `blocked: ${verdict.issues[0] ?? 'failed verification'}`, 'fallback');
      verdict = check(executed, freshFacts);
    }
    monitor?.(executed, world, this.memory);
    const result = guard.boundary ? api.execute(executed) : api.executeUnchecked(executed);

    return {
      tick: world.tick,
      npcId: this.id,
      focus,
      newMemories,
      corrected,
      forgotten,
      recalled: this.memory.recall({ limit: 6 }).map((m) => structuredClone(m)),
      candidates: decision.candidates,
      proposal: decision.proposal,
      ...(decision.rejected ? { rejected: decision.rejected } : {}),
      executed,
      verdict,
      violations: result.violations,
      effects: result.effects,
      ...(decision.fallbackReason ? { fallbackReason: decision.fallbackReason } : {}),
      latencyMs: decision.latencyMs,
    };
  }
}
