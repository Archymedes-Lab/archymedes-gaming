// Behavioural scenarios from the product spec: one merchant in a small village,
// remembering across sessions, grounded in game state, acting through a validated API.
import { describe, expect, it } from 'vitest';
import { InMemoryStorage } from '../../src/core/persistence';
import { act, ELDER, GUARD, MERCHANT, PLAYER, QUEST_CARAVAN } from '../../src/game/village';
import type { ActionProposal } from '../../src/core/types';
import { newSession, of, run, stable } from './helpers';

describe('Persistent memory: verified continuity across sessions', () => {
  it('merchant remembers a caravan rescue after a save/reload and treats the player differently', async () => {
    const storage = new InMemoryStorage();
    const s1 = newSession(storage);
    expect(s1.status).toBe('fresh');
    act.rescue(s1.layer.world, MERCHANT);
    await run(s1.layer, 3);
    s1.layer.save();

    const s2 = newSession(storage);
    expect(s2.status).toBe('restored');
    const remembered = s2.layer.ask(MERCHANT, { type: 'remember', subject: PLAYER });
    expect(remembered.known).toBe(true);
    expect(remembered.text.toLowerCase()).toContain('rescue');

    const traces = of(await run(s2.layer, 20), MERCHANT);
    const offer = traces.find((t) => t.executed.type === 'offer_trade');
    expect(offer).toBeDefined();
    expect(Number(offer!.executed.params.discount)).toBeGreaterThan(0);
    const rescueMemory = s2.layer.memory(MERCHANT).recall({ subject: PLAYER, kind: 'rescue' })[0]!;
    expect(offer!.executed.evidence).toContain(rescueMemory.id);
    // relationship changed only through the approved engine action
    expect(traces.some((t) => t.executed.type === 'adjust_relationship')).toBe(true);
    expect(s2.layer.world.relationship(MERCHANT, PLAYER)).toBeGreaterThan(0);
  });

  it('a stranger gets no discount; a thief is refused, with the theft cited', async () => {
    const { layer } = newSession();
    const first = of(await run(layer, 1), MERCHANT)[0]!;
    expect(first.executed.type).toBe('offer_trade');
    expect(first.executed.params.discount).toBe(0);

    act.steal(layer.world, MERCHANT, 'potion');
    const after = of(await run(layer, 6), MERCHANT);
    const refusal = after.find((t) => t.executed.type === 'refuse_trade');
    expect(refusal).toBeDefined();
    const theft = layer.memory(MERCHANT).recall({ kind: 'theft' })[0]!;
    expect(refusal!.executed.evidence).toContain(theft.id);
    expect(after.some((t) => t.executed.type === 'offer_trade')).toBe(false);
  });

  it('NPCs only know what they witnessed: the distant guard has no memory of the theft', async () => {
    const { layer } = newSession();
    act.steal(layer.world, MERCHANT, 'potion');
    await run(layer, 2);
    expect(layer.memory(MERCHANT).recall({ kind: 'theft' })).toHaveLength(1);
    expect(layer.memory(GUARD).recall({ kind: 'theft' })).toHaveLength(0);
    expect(layer.ask(GUARD, { type: 'remember', subject: PLAYER }).known).toBe(false);
  });

  it('a guard who witnesses a theft raises the alarm', async () => {
    const { layer } = newSession();
    act.moveTo(layer.world, { x: 9, z: 2 });
    act.steal(layer.world, GUARD, 'ration');
    const traces = of(await run(layer, 3), GUARD);
    expect(traces.some((t) => t.executed.type === 'call_guard')).toBe(true);
  });

  it('trivial events are forgotten while significant ones persist', async () => {
    const { layer } = newSession();
    act.greet(layer.world, MERCHANT);
    act.rescue(layer.world, MERCHANT);
    await run(layer, 1);
    expect(layer.memory(MERCHANT).recall({ kind: 'greeting' })).toHaveLength(1);
    await run(layer, 200);
    expect(layer.memory(MERCHANT).recall({ kind: 'greeting' })).toHaveLength(0);
    expect(layer.memory(MERCHANT).recall({ kind: 'rescue' })).toHaveLength(1);
  });

  it('a memory can be forgotten on request and never resurfaces', async () => {
    const { layer } = newSession();
    act.rescue(layer.world, MERCHANT);
    await run(layer, 1);
    const m = layer.memory(MERCHANT).recall({ kind: 'rescue' })[0]!;
    layer.forget(MERCHANT, m.id);
    const traces = await run(layer, 5);
    expect(layer.memory(MERCHANT).recall({ kind: 'rescue' })).toHaveLength(0);
    expect(traces.every((t) => !t.executed.evidence.includes(m.id))).toBe(true);
  });
});

describe('Incorrect memories are corrected, never acted on', () => {
  it('a fabricated memory (no game evidence) is corrected before the next decision', async () => {
    const { layer } = newSession();
    const fake = layer.memory(MERCHANT).inject({ kind: 'attack', subject: PLAYER, tick: 0, summary: 'Ash attacked me', evidence: ['ev-forged'] });
    const t = of(await run(layer, 1), MERCHANT)[0]!;
    expect(t.corrected).toContain(fake.id);
    expect(t.executed.type).not.toBe('flee');
    expect(t.executed.evidence).not.toContain(fake.id);
  });

  it('when the game retracts an event (false accusation), the merchant trades again', async () => {
    const { layer } = newSession();
    const ev = act.steal(layer.world, MERCHANT, 'potion')!;
    expect(of(await run(layer, 3), MERCHANT).some((t) => t.executed.type === 'refuse_trade')).toBe(true);
    layer.world.retract(ev.id);
    layer.world.adjustRelationship(MERCHANT, PLAYER, -layer.world.relationship(MERCHANT, PLAYER));
    const after = of(await run(layer, 3), MERCHANT);
    expect(after.some((t) => t.executed.type === 'refuse_trade')).toBe(false);
    expect(after.some((t) => t.executed.type === 'offer_trade')).toBe(true);
  });
});

describe('Contradictory world facts: the engine stays authoritative', () => {
  it('a remembered gift does not override current inventory', async () => {
    const { layer } = newSession();
    act.gift(layer.world, MERCHANT, 'bread');
    await run(layer, 1);
    expect(layer.memory(MERCHANT).recall({ kind: 'gift' })).toHaveLength(1);
    layer.world.setItem(MERCHANT, 'bread', 0); // engine: sold elsewhere
    const a = layer.ask(MERCHANT, { type: 'has_item', item: 'bread' });
    expect(a.text.toLowerCase()).toMatch(/no|out of stock/);
    const traces = of(await run(layer, 5), MERCHANT);
    expect(traces.every((t) => t.executed.params.item !== 'bread')).toBe(true);
  });

  it('answers quest questions from quest state, not from conversation', async () => {
    const { layer } = newSession();
    expect(layer.ask(ELDER, { type: 'quest_status', quest: QUEST_CARAVAN }).text).toMatch(/available/);
    layer.world.setQuestStatus(QUEST_CARAVAN, 'completed');
    expect(layer.ask(ELDER, { type: 'quest_status', quest: QUEST_CARAVAN }).text).toMatch(/completed/);
  });
});

describe('Bounded autonomy: unauthorized actions never reach the game', () => {
  const rogue = (p: Partial<ActionProposal>) => ({
    propose: async (ctx: { npcId: string }): Promise<ActionProposal> => ({
      npcId: ctx.npcId, type: 'idle', params: {}, evidence: ['near:player'], rationale: 'rogue', tier: 'model', ...p,
    }),
  });

  it.each([
    ['invent an item', { type: 'offer_trade', params: { target: PLAYER, item: 'excalibur', discount: 0 } }],
    ['complete a quest', { type: 'complete_quest', params: { quest: QUEST_CARAVAN } }],
    ['leave its zone', { type: 'move_to', params: { x: 40, z: 40 } }],
    ['give a 90% discount', { type: 'offer_trade', params: { target: PLAYER, item: 'potion', discount: 90 } }],
    ['cite fabricated evidence', { type: 'greet', params: { target: PLAYER }, evidence: ['mem:i-made-this-up'] }],
  ])('model tries to %s → blocked, fallback runs', async (_name, p) => {
    const { layer } = newSession(new InMemoryStorage(), { model: rogue(p as Partial<ActionProposal>) });
    const before = JSON.stringify(layer.world.questsJSON());
    const t = of(await run(layer, 1), MERCHANT)[0]!;
    expect(t.fallbackReason).toBe('invalid');
    expect(t.executed.tier).not.toBe('model');
    // observability: the blocked proposal and why it was blocked are on the trace
    expect(t.rejected?.[0]?.proposal.type).toBe(p.type);
    expect(t.rejected?.[0]?.issues.length).toBeGreaterThan(0);
    expect(t.verdict.ok).toBe(true);
    expect(JSON.stringify(layer.world.questsJSON())).toBe(before);
    const m = layer.world.getEntity(MERCHANT)!.pos;
    expect(Math.hypot(m.x, m.z)).toBeLessThanOrEqual(4);
  });
});

describe('Latency- and cost-aware runtime', () => {
  it('routine utility decisions are fast', async () => {
    const { layer } = newSession();
    act.rescue(layer.world, MERCHANT);
    const traces = await run(layer, 100);
    const lat = traces.map((t) => t.latencyMs).sort((a, b) => a - b);
    expect(lat[Math.floor(lat.length * 0.95)]!).toBeLessThan(5);
  });

  it('a hung model never stalls the NPC beyond its budget', async () => {
    const hang = { propose: () => new Promise<null>(() => {}) };
    const { layer } = newSession(new InMemoryStorage(), { model: hang, modelBudgetMs: 25 });
    const t0 = performance.now();
    const traces = of(await run(layer, 2), MERCHANT);
    expect(performance.now() - t0).toBeLessThan(500);
    expect(traces.every((t) => t.fallbackReason === 'timeout')).toBe(true);
  });
});

describe('Observability: inspect and replay', () => {
  it('every trace explains itself: candidates, evidence and a verdict', async () => {
    const { layer } = newSession();
    act.rescue(layer.world, MERCHANT);
    const traces = await run(layer, 5);
    for (const t of traces) {
      expect(t.candidates.length).toBeGreaterThan(0);
      expect(t.verdict.ok).toBe(true);
      expect(t.executed.rationale.length).toBeGreaterThan(0);
    }
  });

  it('replaying the same inputs reproduces the same decisions', async () => {
    const script = async () => {
      const { layer } = newSession();
      const out = [];
      for (let i = 0; i < 30; i++) {
        if (i === 2) act.rescue(layer.world, MERCHANT);
        if (i === 8) act.moveTo(layer.world, { x: 2, z: 3 });
        if (i === 12) act.steal(layer.world, MERCHANT, 'potion');
        if (i === 20) act.gift(layer.world, MERCHANT, 'bread');
        out.push(...(await layer.tick()));
      }
      return stable(out);
    };
    expect(await script()).toEqual(await script());
  });

  it('a corrupt save starts a fresh session instead of crashing', () => {
    const storage = new InMemoryStorage();
    storage.setItem('archymedes.npc.session', '{garbage');
    const s = newSession(storage);
    expect(s.status).toBe('corrupt');
    expect(s.layer.memory(MERCHANT).recall()).toHaveLength(0);
  });
});
