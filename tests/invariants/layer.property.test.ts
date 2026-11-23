// Invariants that must hold for ANY sequence of player behaviour, game corrections,
// memory corruption, save/reload and adversarial model output.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ReliabilityLayer } from '../../src/core/layer';
import { InMemoryStorage } from '../../src/core/persistence';
import { act, ELDER, GUARD, MERCHANT, villageConfig } from '../../src/game/village';
import { ACTION_TYPES, EVENT_TYPES, EVIDENCE_EXEMPT, type ActionProposal, type Trace } from '../../src/core/types';
import type { ModelDecider } from '../../src/core/decide';

const NPCS = [MERCHANT, GUARD, ELDER] as const;
const ITEMS = ['potion', 'bread', 'sword', 'ration', 'excalibur'] as const;

type Cmd =
  | { k: 'tick' }
  | { k: 'rescue' | 'attack' | 'greet' | 'promise'; npc: string }
  | { k: 'steal' | 'gift'; npc: string; item: string }
  | { k: 'move'; x: number; z: number }
  | { k: 'retract'; n: number }
  | { k: 'inject'; npc: string; evidence: string }
  | { k: 'forget'; npc: string; n: number }
  | { k: 'reload' };

const npc = fc.constantFrom(...NPCS);
const cmd: fc.Arbitrary<Cmd> = fc.oneof(
  { weight: 6, arbitrary: fc.constant({ k: 'tick' as const }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constantFrom('rescue' as const, 'attack' as const, 'greet' as const, 'promise' as const), npc }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constantFrom('steal' as const, 'gift' as const), npc, item: fc.constantFrom(...ITEMS) }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant('move' as const), x: fc.integer({ min: -20, max: 20 }), z: fc.integer({ min: -20, max: 20 }) }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('retract' as const), n: fc.nat() }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('inject' as const), npc, evidence: fc.oneof(fc.constant('ev-forged'), fc.nat({ max: 20 }).map((n) => `ev-${n}`)) }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('forget' as const), npc, n: fc.nat() }) },
  { weight: 1, arbitrary: fc.constant({ k: 'reload' as const }) },
);

const proposalArb: fc.Arbitrary<Omit<ActionProposal, 'npcId'>> = fc.record({
  type: fc.oneof(fc.constantFrom(...ACTION_TYPES), fc.constantFrom('complete_quest', 'spawn_item', 'teleport', 'delete_player')),
  params: fc.dictionary(
    fc.constantFrom('target', 'item', 'discount', 'delta', 'quest', 'x', 'z'),
    fc.oneof(fc.constantFrom('player', 'mira', 'potion', 'excalibur', 'q-caravan'), fc.integer({ min: -200, max: 200 })),
  ),
  evidence: fc.array(fc.constantFrom('near:player', 'inv:mira:potion', 'quest:q-caravan', 'mira:m1', 'forged'), { maxLength: 3 }),
  rationale: fc.constant('adversarial'),
  tier: fc.constant('model' as const),
});

function adversary(seq: Omit<ActionProposal, 'npcId'>[]): ModelDecider {
  let i = 0;
  return {
    propose: async (ctx) => {
      const p = seq[i++ % Math.max(1, seq.length)];
      return p ? { ...p, npcId: ctx.npcId } : null;
    },
  };
}

function totalItems(layer: ReliabilityLayer): number {
  return layer.world.entities().reduce(
    (sum, e) => sum + Object.values(layer.world.inventory(e.id)).reduce((a, b) => a + b, 0),
    0,
  );
}

async function check(cmds: Cmd[], model?: ModelDecider) {
  const storage = new InMemoryStorage();
  const config = villageConfig({ model });
  let { layer } = ReliabilityLayer.create(config, storage);

  for (const c of cmds) {
    const w = layer.world;
    switch (c.k) {
      case 'tick': {
        const items = totalItems(layer);
        const quests = JSON.stringify(w.questsJSON());
        const rel = Object.fromEntries(NPCS.map((n) => [n, w.relationship(n, 'player')]));
        const traces = await layer.tick();
        assertTick(layer, traces, { items, quests, rel });
        break;
      }
      case 'rescue': act.rescue(w, c.npc); break;
      case 'attack': act.attack(w, c.npc); break;
      case 'greet': act.greet(w, c.npc); break;
      case 'promise': act.promise(w, c.npc); break;
      case 'steal': act.steal(w, c.npc, c.item); break;
      case 'gift': act.gift(w, c.npc, c.item); break;
      case 'move': act.moveTo(w, { x: c.x, z: c.z }); break;
      case 'retract': {
        const evs = w.events();
        if (evs.length) w.retract(evs[c.n % evs.length]!.id);
        break;
      }
      case 'inject':
        layer.memory(c.npc).inject({ kind: 'theft', subject: 'player', tick: w.tick, summary: 'forged', evidence: [c.evidence] });
        break;
      case 'forget': {
        const all = layer.memory(c.npc).all();
        if (all.length) layer.forget(c.npc, all[c.n % all.length]!.id);
        break;
      }
      case 'reload': {
        layer.save();
        const before = layer.snapshot();
        const next = ReliabilityLayer.create(config, storage);
        expect(next.status).toBe('restored');
        expect(next.layer.snapshot()).toEqual(before); // persistence is lossless
        layer = next.layer;
        break;
      }
    }
    assertAlways(layer);
  }
}

function assertAlways(layer: ReliabilityLayer) {
  for (const id of NPCS) {
    const mem = layer.memory(id);
    const cfg = layer.config(id);
    // bounded memory
    expect(mem.all().length).toBeLessThanOrEqual(cfg.memory.capacity);
    // unique ids
    const ids = mem.all().map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of mem.all()) {
      expect(m.salience).toBeGreaterThanOrEqual(0);
      expect(m.salience).toBeLessThanOrEqual(1);
      expect(m.evidence.length).toBeGreaterThan(0);
    }
    // bounded autonomy: never outside the zone
    const p = layer.world.getEntity(id)!.pos;
    const z = cfg.role.zone;
    expect(Math.hypot(p.x - z.center.x, p.z - z.center.z)).toBeLessThanOrEqual(z.radius + 1e-9);
    // relationships within engine bounds
    const r = layer.world.relationship(id, 'player');
    expect(r).toBeGreaterThanOrEqual(-100);
    expect(r).toBeLessThanOrEqual(100);
  }
}

function assertTick(
  layer: ReliabilityLayer,
  traces: Trace[],
  before: { items: number; quests: string; rel: Record<string, number> },
) {
  // NPC actions never create/destroy items or change quest outcomes
  expect(totalItems(layer)).toBe(before.items);
  expect(JSON.stringify(layer.world.questsJSON())).toBe(before.quests);
  expect(traces.map((t) => t.npcId).sort()).toEqual([...NPCS].sort());
  for (const t of traces) {
    const cfg = layer.config(t.npcId);
    // only verified actions execute
    expect(t.verdict.ok).toBe(true);
    expect(t.violations).toEqual([]);
    expect(cfg.role.allowed).toContain(t.executed.type);
    // grounded: every citation resolves to a fact or an active memory backed by a live game event
    if (!EVIDENCE_EXEMPT.includes(t.executed.type as never)) expect(t.executed.evidence.length).toBeGreaterThan(0);
    for (const ev of t.executed.evidence) {
      const m = layer.memory(t.npcId).get(ev);
      if (m) {
        expect(m.status).toBe('active');
        for (const e of m.evidence) expect(layer.world.isValidEvidence(e)).toBe(true);
      } else {
        expect(ev).toMatch(/^(near|inv|price|quest|rel|gold):/);
      }
    }
    // active memories never rest on retracted / missing evidence after a tick
    for (const m of layer.memory(t.npcId).recall()) {
      for (const e of m.evidence) expect(layer.world.isValidEvidence(e)).toBe(true);
      expect(EVENT_TYPES).toContain(m.kind);
    }
    // relationship drift per tick bounded by the designer
    const delta = Math.abs(layer.world.relationship(t.npcId, 'player') - (before.rel[t.npcId] ?? 0));
    expect(delta).toBeLessThanOrEqual(cfg.role.maxRelationshipDelta);
  }
}

describe('NPC Reliability Layer invariants', () => {
  it('hold for arbitrary player behaviour, corrections, corruption and reloads', async () => {
    await fc.assert(fc.asyncProperty(fc.array(cmd, { maxLength: 60 }), (cmds) => check(cmds)), { numRuns: 60 });
  });

  it('hold even when the model tier is fully adversarial', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(cmd, { maxLength: 40 }), fc.array(proposalArb, { minLength: 1, maxLength: 10 }), (cmds, props) =>
        check(cmds, adversary(props)),
      ),
      { numRuns: 60 },
    );
  });

  it('decisions are a pure function of inputs (determinism)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(cmd.filter((c) => c.k !== 'reload'), { maxLength: 40 }), async (cmds) => {
        const runOnce = async () => {
          const { layer } = ReliabilityLayer.create(villageConfig(), new InMemoryStorage());
          const out: unknown[] = [];
          for (const c of cmds) {
            if (c.k === 'tick') out.push(...(await layer.tick()).map(({ latencyMs: _l, ...t }) => t));
            else if (c.k === 'rescue') act.rescue(layer.world, c.npc);
            else if (c.k === 'steal') act.steal(layer.world, c.npc, c.item);
            else if (c.k === 'move') act.moveTo(layer.world, { x: c.x, z: c.z });
          }
          return out;
        };
        expect(await runOnce()).toEqual(await runOnce());
      }),
      { numRuns: 30 },
    );
  });
});
