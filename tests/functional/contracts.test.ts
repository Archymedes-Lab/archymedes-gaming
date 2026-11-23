import { describe, expect, it } from 'vitest';
import { deriveContracts, settle } from '../../src/core/contracts';
import { GameActionAPI } from '../../src/core/actions';
import { groundFacts } from '../../src/core/grounding';
import { MemoryStore } from '../../src/core/memory';
import { verify } from '../../src/core/verify';
import { utilityCandidates } from '../../src/core/decide';
import { GameWorld } from '../../src/core/world';
import type { ActionProposal, KnowledgePolicy, MemoryPolicy, RoleSpec } from '../../src/core/types';

function world() {
  const w = new GameWorld();
  w.defineItem({ id: 'bread', name: 'Bread', basePrice: 2 });
  w.defineItem({ id: 'potion', name: 'Potion', basePrice: 12 });
  w.addEntity({ id: 'ash', kind: 'player', name: 'Ash', pos: { x: 0, z: 2 }, faction: 't' });
  w.addEntity({ id: 'mira', kind: 'npc', name: 'Mira', pos: { x: 0, z: 0 }, faction: 'v' });
  w.setItem('ash', 'bread', 5);
  w.setItem('mira', 'potion', 5);
  return w;
}
const promise = (w: GameWorld, qty = 2, due = 10) =>
  w.emit({ type: 'promise', actor: 'ash', target: 'mira', pos: { x: 0, z: 2 }, data: { item: 'bread', qty, due } });
const gift = (w: GameWorld) => {
  w.transfer('ash', 'mira', 'bread');
  return w.emit({ type: 'gift', actor: 'ash', target: 'mira', pos: { x: 0, z: 2 }, data: { item: 'bread' } });
};
const statusOf = (w: GameWorld, id: string) => deriveContracts(w).find((c) => c.id === id)!.status;

describe('contracts are derived from the event log, never from text', () => {
  it('a promise is open until delivered in full, then kept', () => {
    const w = world();
    const p = promise(w);
    expect(statusOf(w, p.id)).toBe('open');
    gift(w);
    expect(statusOf(w, p.id)).toBe('open');
    gift(w);
    expect(statusOf(w, p.id)).toBe('kept');
  });

  it('a promise not delivered by its due tick is broken; late delivery does not count', () => {
    const w = world();
    const p = promise(w, 1, 3);
    for (let i = 0; i < 4; i++) w.advance();
    expect(statusOf(w, p.id)).toBe('broken');
    gift(w);
    expect(statusOf(w, p.id)).toBe('broken');
  });

  it('each delivery fulfils one promise, earliest first', () => {
    const w = world();
    const a = promise(w, 1);
    const b = promise(w, 1);
    gift(w);
    expect([statusOf(w, a.id), statusOf(w, b.id)]).toEqual(['kept', 'open']);
  });

  it('retracting a delivery re-opens the promise', () => {
    const w = world();
    const p = promise(w, 1);
    const g = gift(w);
    expect(statusOf(w, p.id)).toBe('kept');
    w.retract(g.id);
    expect(statusOf(w, p.id)).toBe('open');
  });
});

describe('settlement: the engine records outcomes as events and keeps them true', () => {
  it('emits promise_kept once, and retracts it if the delivery is retracted', () => {
    const w = world();
    promise(w, 1);
    const g = gift(w);
    settle(w);
    settle(w);
    const kept = w.events().filter((e) => e.type === 'promise_kept' && !e.retracted);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ actor: 'ash', target: 'mira' });
    w.retract(g.id);
    settle(w);
    expect(w.events().filter((e) => e.type === 'promise_kept' && !e.retracted)).toHaveLength(0);
  });

  it('a kept-promise memory is corrected when its settlement is retracted', () => {
    const w = world();
    const policy: MemoryPolicy = { capacity: 10, forgetBelow: 0.01, perceptionRadius: 8, rules: { promise_kept: { salience: 0.8, valence: 0.8, halfLife: 1000 } } };
    const mem = new MemoryStore('mira', policy);
    promise(w, 1);
    const g = gift(w);
    settle(w);
    const kept = w.events().find((e) => e.type === 'promise_kept')!;
    const m = mem.observe(kept, { x: 0, z: 0 })!;
    w.retract(g.id);
    settle(w);
    expect(mem.reconcile(w)).toEqual([m.id]);
  });
});

const merchant: RoleSpec = {
  role: 'merchant', allowed: ['idle', 'greet', 'offer_trade', 'pledge', 'adjust_relationship'],
  zone: { center: { x: 0, z: 0 }, radius: 4 }, maxDiscount: 30, maxRelationshipDelta: 10,
};
const knowledge: KnowledgePolicy = { categories: ['inventory', 'prices', 'nearby', 'relationships', 'commitments'], perceptionRadius: 8 };
const P = (type: string, params: ActionProposal['params'], evidence: string[]): ActionProposal => ({
  npcId: 'mira', type, params, evidence, rationale: '', tier: 'utility',
});

describe('NPC pledges are engine commitments the verifier enforces', () => {
  it('a pledge must be within the designer bound', () => {
    const api = new GameActionAPI(world(), { mira: merchant });
    expect(api.validate(P('pledge', { target: 'ash', discount: 20 }, [])).ok).toBe(true);
    expect(api.validate(P('pledge', { target: 'ash', discount: 80 }, [])).violations[0]!.code).toBe('param_out_of_range');
  });

  it('an open pledge is a grounded fact, and offers that undercut it are rejected', () => {
    const w = world();
    const api = new GameActionAPI(w, { mira: merchant });
    api.execute(P('pledge', { target: 'ash', discount: 20 }, []));
    const facts = groundFacts(w, 'mira', knowledge);
    const pledge = [...facts.values()].find((f) => f.kind === 'pledge')!;
    expect(pledge).toMatchObject({ subject: 'ash', value: 20 });
    const mem = new MemoryStore('mira', { capacity: 5, forgetBelow: 0.01, perceptionRadius: 8, rules: {} });
    const ok = { ok: true, violations: [] };
    const under = P('offer_trade', { target: 'ash', item: 'potion', discount: 0 }, ['near:ash', 'inv:mira:potion']);
    const v = verify(under, facts, mem, ok);
    expect(v.consistent).toBe(false);
    expect(v.issues.join(' ')).toMatch(/pledge/);
    const honour = P('offer_trade', { target: 'ash', item: 'potion', discount: 20 }, ['near:ash', 'inv:mira:potion', pledge.id]);
    expect(verify(honour, facts, mem, ok).consistent).toBe(true);
  });

  it('honouring a pledge closes it', () => {
    const w = world();
    const api = new GameActionAPI(w, { mira: merchant });
    api.execute(P('pledge', { target: 'ash', discount: 20 }, []));
    w.advance();
    api.execute(P('offer_trade', { target: 'ash', item: 'potion', discount: 20 }, []));
    expect(deriveContracts(w).find((c) => c.kind === 'pledge')!.status).toBe('kept');
    expect([...groundFacts(w, 'mira', knowledge).values()].some((f) => f.kind === 'pledge')).toBe(false);
  });

  it('utility: a kept promise earns a pledge, and offers honour open pledges', () => {
    const w = world();
    const policy: MemoryPolicy = { capacity: 10, forgetBelow: 0.01, perceptionRadius: 8, rules: { promise_kept: { salience: 0.8, valence: 0.8, halfLife: 1000 } } };
    const mem = new MemoryStore('mira', policy);
    promise(w, 1);
    gift(w);
    settle(w);
    mem.observe(w.events().find((e) => e.type === 'promise_kept')!, { x: 0, z: 0 });
    const ctx = () => ({ npcId: 'mira', role: merchant, tick: w.tick, facts: groundFacts(w, 'mira', knowledge), memory: mem, focus: 'ash', contracts: true });
    const pledge = utilityCandidates(ctx()).find((c) => c.proposal.type === 'pledge')!.proposal;
    expect(Number(pledge.params.discount)).toBeGreaterThan(0);
    new GameActionAPI(w, { mira: merchant }).execute(pledge);
    const offer = utilityCandidates(ctx()).find((c) => c.proposal.type === 'offer_trade')!.proposal;
    expect(Number(offer.params.discount)).toBeGreaterThanOrEqual(Number(pledge.params.discount));
    expect(offer.evidence.some((e) => e.startsWith('pledge:'))).toBe(true);
    expect(utilityCandidates(ctx()).some((c) => c.proposal.type === 'pledge')).toBe(false); // no double pledging
  });
});
