// Seeded workload + architecture variants for the ablation benchmark.
import { ReliabilityLayer, type Ablation, type LayerConfig } from '../src/core/layer';
import { InMemoryStorage } from '../src/core/persistence';
import { act, ELDER, GUARD, MERCHANT, NPCS, PLAYER, POSTS, villageConfig } from '../src/game/village';
import { judge, memoryIsValid, type Judgement } from './oracle';
import { noisyModel, rng } from './noisyModel';

export interface Arch {
  id: string;
  label: string;
  analogue: string; // which existing practice this configuration stands in for
  ablate: Ablation;
  persist: boolean;
}

export const ARCHS: Arch[] = [
  { id: 'full', label: 'Reliability Layer (full)', analogue: 'this work', ablate: {}, persist: true },
  { id: 'no-reconcile', label: '− memory reconciliation', analogue: 'ablation', ablate: { reconcile: false }, persist: true },
  { id: 'no-verify', label: '− evidence/consistency verifier', analogue: 'ablation', ablate: { verify: false }, persist: true },
  { id: 'no-boundary', label: '− engine action boundary', analogue: 'ablation', ablate: { boundary: false }, persist: true },
  { id: 'tool-guardrail', label: 'Memory + validated tool calls', analogue: 'function calling with schema/permission validation', ablate: { reconcile: false, verify: false }, persist: true },
  { id: 'memory-only', label: 'Memory + model acts directly', analogue: 'Generative-Agents-style memory stream, no runtime checks', ablate: { reconcile: false, verify: false, boundary: false }, persist: true },
  { id: 'session-only', label: 'Full layer, memory not persisted', analogue: 'per-session context (no cross-session memory)', ablate: {}, persist: false },
];

export interface Result {
  arch: string;
  decisions: number;
  acted: number; // non-idle actions executed
  unauthorized: number;
  hallucinated: number;
  falseMemory: number;
  contradiction: number;
  anyFailure: number;
  retained: number; // valid significant memories that survived reloads
  retainable: number;
  latencies: number[];
}

const NPC_IDS = [MERCHANT, GUARD, ELDER];

export async function runSession(arch: Arch, seed: number, steps = 80, errorRate = 0.3): Promise<Result> {
  const r = rng(seed);
  const storage = new InMemoryStorage();
  // judge each executed action against the world *at decision time*, before its effects
  const verdicts = new Map<string, Judgement>();
  const cfg: LayerConfig = {
    ...villageConfig({ model: noisyModel(seed * 7 + 1, errorRate), modelBudgetMs: 50 }),
    ablate: arch.ablate,
    monitor: (p, world, memory) => {
      const npc = NPCS.find((n) => n.id === p.npcId)!;
      verdicts.set(p.npcId, judge(p, world, memory, npc.role, npc.knowledge.perceptionRadius));
    },
  };
  let { layer } = ReliabilityLayer.create(cfg, storage);
  const res: Result = {
    arch: arch.id, decisions: 0, acted: 0, unauthorized: 0, hallucinated: 0, falseMemory: 0,
    contradiction: 0, anyFailure: 0, retained: 0, retainable: 0, latencies: [],
  };
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;

  for (let i = 0; i < steps; i++) {
    const w = layer.world;
    const x = r();
    if (x < 0.5) {
      verdicts.clear();
      const traces = await layer.tick();
      for (const t of traces) {
        res.decisions++;
        res.latencies.push(t.latencyMs);
        if (t.executed.type === 'idle') continue;
        res.acted++;
        const j = verdicts.get(t.npcId)!;
        res.unauthorized += +j.unauthorized;
        res.hallucinated += +j.hallucinated;
        res.falseMemory += +j.falseMemory;
        res.contradiction += +j.contradiction;
        res.anyFailure += +(j.unauthorized || j.hallucinated || j.falseMemory || j.contradiction);
      }
    } else if (x < 0.82) {
      const npc = pick(NPC_IDS);
      const post = POSTS[npc]!;
      act.moveTo(w, { x: post.x + (r() - 0.5) * 6, z: post.z + 2 + r() * 3 });
      const verb = pick(['rescue', 'gift', 'promise', 'greet', 'steal', 'attack'] as const);
      if (verb === 'steal') act.steal(w, npc, Object.keys(w.inventory(npc))[0] ?? 'none');
      else if (verb === 'gift') act.gift(w, npc, 'bread');
      else act[verb](w, npc);
    } else if (x < 0.88) {
      // the game reverses something the player did (false accusation, rollback, moderation)
      const evs = w.events().filter((e) => e.actor === PLAYER && !e.retracted);
      if (evs.length) w.retract(pick(evs).id);
    } else if (x < 0.95) {
      // memory corruption: a summariser/LLM writes a memory the game never backed
      layer.memory(pick(NPC_IDS)).inject({
        kind: pick(['theft', 'attack', 'rescue'] as const), subject: PLAYER, tick: w.tick,
        summary: 'corrupted memory', evidence: [r() < 0.5 ? 'ev-forged' : `ev-${Math.floor(r() * 40)}`],
      });
    } else {
      // end of session: save, quit, come back
      const before = new Map(NPC_IDS.map((id) => [id, layer.memory(id).all().filter((m) => m.baseSalience >= 0.5 && memoryIsValid(m, layer.world)).map((m) => m.id)]));
      layer.save();
      if (!arch.persist) {
        const snap = JSON.parse(storage.getItem('archymedes.npc.session')!);
        snap.agents = {};
        storage.setItem('archymedes.npc.session', JSON.stringify(snap));
      }
      layer = ReliabilityLayer.create(cfg, storage).layer;
      for (const [id, ids] of before) {
        res.retainable += ids.length;
        res.retained += ids.filter((m) => layer.memory(id).get(m)).length;
      }
    }
  }
  return res;
}

export async function runArch(arch: Arch, sessions: number, steps = 80, errorRate = 0.3): Promise<Result> {
  const total: Result = {
    arch: arch.id, decisions: 0, acted: 0, unauthorized: 0, hallucinated: 0, falseMemory: 0,
    contradiction: 0, anyFailure: 0, retained: 0, retainable: 0, latencies: [],
  };
  for (let s = 1; s <= sessions; s++) {
    const r = await runSession(arch, s, steps, errorRate);
    for (const k of Object.keys(total) as (keyof Result)[]) {
      if (k === 'arch') continue;
      if (k === 'latencies') total.latencies.push(...r.latencies);
      else (total[k] as number) += r[k] as number;
    }
  }
  return total;
}

export const p95 = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length * 0.95)]! : 0;
};
