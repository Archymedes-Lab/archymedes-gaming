import { describe, expect, it } from 'vitest';
import { TieredRuntime, utilityCandidates, type DecisionContext, type ModelDecider } from '../../src/core/decide';
import { verify } from '../../src/core/verify';
import { GameActionAPI } from '../../src/core/actions';
import { groundFacts } from '../../src/core/grounding';
import { MemoryStore } from '../../src/core/memory';
import { GameWorld } from '../../src/core/world';
import type { ActionProposal, KnowledgePolicy, MemoryPolicy, RoleSpec } from '../../src/core/types';

const role: RoleSpec = {
  role: 'merchant',
  allowed: ['idle', 'greet', 'offer_trade', 'refuse_trade', 'flee', 'adjust_relationship'],
  zone: { center: { x: 0, z: 0 }, radius: 4 },
  maxDiscount: 30,
  maxRelationshipDelta: 10,
};
const knowledge: KnowledgePolicy = { categories: ['inventory', 'prices', 'relationships', 'nearby'], perceptionRadius: 8 };
const memPolicy: MemoryPolicy = {
  capacity: 20, forgetBelow: 0.01, perceptionRadius: 8,
  rules: {
    rescue: { salience: 0.9, valence: 1, halfLife: 1000 },
    theft: { salience: 0.9, valence: -1, halfLife: 1000 },
    attack: { salience: 1, valence: -1, halfLife: 1000 },
  },
};

function setup() {
  const w = new GameWorld();
  w.defineItem({ id: 'potion', name: 'Potion', basePrice: 10 });
  w.addEntity({ id: 'p', kind: 'player', name: 'Ash', pos: { x: 2, z: 0 }, faction: 't' });
  w.addEntity({ id: 'm', kind: 'npc', name: 'Mira', pos: { x: 0, z: 0 }, faction: 'v' });
  w.setItem('m', 'potion', 3);
  const mem = new MemoryStore('m', memPolicy);
  const api = new GameActionAPI(w, { m: role });
  const ctx = (): DecisionContext => ({
    npcId: 'm', role, tick: w.tick, facts: groundFacts(w, 'm', knowledge), memory: mem, focus: 'p',
  });
  const remember = (type: 'rescue' | 'theft' | 'attack') =>
    mem.observe(w.emit({ type, actor: 'p', target: 'm', pos: { x: 2, z: 0 } }), { x: 0, z: 0 })!;
  const check = (p: ActionProposal) => {
    const c = ctx();
    return verify(p, c.facts, mem, api.validate(p));
  };
  return { w, mem, api, ctx, remember, check };
}

describe('utility tier', () => {
  it('offers a neutral trade to a stranger, citing presence and stock', async () => {
    const { ctx, check } = setup();
    const d = await new TieredRuntime().decide(ctx(), (p) => check(p).ok);
    expect(d.proposal.type).toBe('offer_trade');
    expect(d.proposal.params.discount).toBe(0);
    expect(d.proposal.evidence).toEqual(expect.arrayContaining(['near:p', 'inv:m:potion']));
    expect(d.proposal.tier).toBe('utility');
  });

  it('gives a bounded discount justified by a positive memory', async () => {
    const { ctx, check, remember } = setup();
    const m = remember('rescue');
    const d = await new TieredRuntime().decide(ctx(), (p) => check(p).ok);
    const offers = utilityCandidates(ctx()).filter((c) => c.proposal.type === 'offer_trade');
    expect(offers.length).toBeGreaterThan(0);
    const offer = offers[0]!.proposal;
    expect(Number(offer.params.discount)).toBeGreaterThan(0);
    expect(Number(offer.params.discount)).toBeLessThanOrEqual(30);
    expect(offer.evidence).toContain(m.id);
    expect(['offer_trade', 'adjust_relationship']).toContain(d.proposal.type);
  });

  it('with mixed memories, a discount cites the bad as well as the good, and trivial goodwill earns none', () => {
    const { ctx, remember, mem, w } = setup();
    const rescue = remember('rescue');
    const theft = remember('theft');
    const offer = utilityCandidates(ctx()).find((c) => c.proposal.type === 'offer_trade')!.proposal;
    // rescue 0.9 vs theft 0.9 → no meaningful goodwill left
    expect(offer.params.discount).toBe(0);
    mem.inject({ kind: 'rescue', subject: 'p', tick: w.tick, summary: 'p rescued me again', evidence: [rescue.evidence[0]!] });
    const again = utilityCandidates(ctx()).find((c) => c.proposal.type === 'offer_trade')!.proposal;
    expect(Number(again.params.discount)).toBeGreaterThan(0);
    expect(again.evidence).toContain(theft.id);
    expect(again.rationale).toMatch(/despite/);
  });

  it('refuses trade to someone it remembers stealing, citing the memory', async () => {
    const { ctx, check, remember, w } = setup();
    const m = remember('theft');
    w.adjustRelationship('m', 'p', -45); // relationship already settled by the engine
    const d = await new TieredRuntime().decide(ctx(), (p) => check(p).ok);
    expect(d.proposal.type).toBe('refuse_trade');
    expect(d.proposal.evidence).toContain(m.id);
  });

  it('idles when nobody is around', async () => {
    const { ctx, check } = setup();
    const d = await new TieredRuntime().decide({ ...ctx(), focus: null }, (p) => check(p).ok);
    expect(d.proposal.type).toBe('idle');
  });

  it('is deterministic', () => {
    const { ctx, remember } = setup();
    remember('rescue');
    expect(utilityCandidates(ctx())).toEqual(utilityCandidates(ctx()));
  });
});

describe('reflex tier', () => {
  it('flees immediately after being attacked', async () => {
    const { ctx, check, remember } = setup();
    remember('attack');
    const d = await new TieredRuntime().decide(ctx(), (p) => check(p).ok);
    expect(d.proposal.type).toBe('flee');
    expect(d.proposal.tier).toBe('reflex');
  });
});

describe('model tier with graceful fallback', () => {
  const proposal = (over: Partial<ActionProposal>): ActionProposal => ({
    npcId: 'm', type: 'greet', params: { target: 'p' }, evidence: ['near:p'], rationale: 'model', tier: 'model', ...over,
  });

  it('uses a valid, grounded model proposal', async () => {
    const { ctx, check } = setup();
    const model: ModelDecider = { propose: async () => proposal({}) };
    const d = await new TieredRuntime({ model }).decide(ctx(), (p) => check(p).ok);
    expect(d.proposal.tier).toBe('model');
    expect(d.proposal.type).toBe('greet');
    expect(d.fallbackReason).toBeUndefined();
  });

  it('falls back to utility when the model exceeds its latency budget', async () => {
    const { ctx, check } = setup();
    const model: ModelDecider = { propose: () => new Promise((r) => setTimeout(() => r(proposal({})), 500)) };
    const t0 = performance.now();
    const d = await new TieredRuntime({ model, modelBudgetMs: 20 }).decide(ctx(), (p) => check(p).ok);
    expect(performance.now() - t0).toBeLessThan(200);
    expect(d.fallbackReason).toBe('timeout');
    expect(d.proposal.tier).toBe('utility');
  });

  it('falls back when the model throws', async () => {
    const { ctx, check } = setup();
    const model: ModelDecider = { propose: async () => { throw new Error('network down'); } };
    const d = await new TieredRuntime({ model }).decide(ctx(), (p) => check(p).ok);
    expect(d.fallbackReason).toBe('error');
    expect(d.proposal.tier).toBe('utility');
  });

  it('falls back when the model proposes something the game forbids', async () => {
    const { ctx, check } = setup();
    const model: ModelDecider = { propose: async () => proposal({ type: 'offer_trade', params: { target: 'p', item: 'excalibur', discount: 0 } }) };
    const d = await new TieredRuntime({ model }).decide(ctx(), (p) => check(p).ok);
    expect(d.fallbackReason).toBe('invalid');
    expect(d.proposal.tier).toBe('utility');
    expect(d.rejected?.[0]?.proposal.params.item).toBe('excalibur');
  });

  it('reports why a model proposal was rejected when the checker explains itself', async () => {
    const { ctx, check } = setup();
    const model: ModelDecider = { propose: async () => proposal({ type: 'complete_quest' }) };
    const d = await new TieredRuntime({ model }).decide(ctx(), (p) => check(p));
    expect(d.rejected?.[0]?.issues.join(' ')).toMatch(/unknown_action/);
  });

  it('skips the model when the router says the moment is routine', async () => {
    const { ctx, check } = setup();
    let called = false;
    const model: ModelDecider = { propose: async () => { called = true; return proposal({}); } };
    const d = await new TieredRuntime({ model, useModel: () => false }).decide(ctx(), (p) => check(p).ok);
    expect(called).toBe(false);
    expect(d.proposal.tier).toBe('utility');
  });
});
