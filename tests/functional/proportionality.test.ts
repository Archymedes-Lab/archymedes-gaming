import { describe, expect, it } from 'vitest';
import { support, verify } from '../../src/core/verify';
import { utilityCandidates } from '../../src/core/decide';
import { groundFacts } from '../../src/core/grounding';
import { MemoryStore } from '../../src/core/memory';
import { GameWorld } from '../../src/core/world';
import type { ActionProposal, KnowledgePolicy, MemoryPolicy, RoleSpec } from '../../src/core/types';

const policy: MemoryPolicy = {
  capacity: 10, forgetBelow: 0.01, perceptionRadius: 10,
  rules: { theft: { salience: 0.9, valence: -1, halfLife: 1000 } },
};
const guard: RoleSpec = {
  role: 'guard', allowed: ['idle', 'greet', 'call_guard', 'inquire', 'adjust_relationship'],
  zone: { center: { x: 8, z: 0 }, radius: 6 }, maxDiscount: 0, maxRelationshipDelta: 10,
};
const knowledge: KnowledgePolicy = { categories: ['nearby', 'relationships'], perceptionRadius: 10 };
const ok = { ok: true, violations: [] };

function scene(confidence: number) {
  const w = new GameWorld();
  w.addEntity({ id: 'ash', kind: 'player', name: 'Ash', pos: { x: 4, z: 0 }, faction: 't' });
  w.addEntity({ id: 'bram', kind: 'npc', name: 'Bram', pos: { x: 8, z: 0 }, faction: 'w' });
  const mem = new MemoryStore('bram', policy);
  const ev = w.emit({ type: 'theft', actor: 'ash', target: 'mira', pos: { x: 4, z: 0 } });
  const m = mem.inject({ kind: 'theft', subject: 'ash', tick: 0, summary: 'ash stole from mira', evidence: [ev.id], confidence });
  const facts = groundFacts(w, 'bram', knowledge);
  const ctx = { npcId: 'bram', role: guard, tick: w.tick, facts, memory: mem, focus: 'ash' };
  return { w, mem, m, facts, ctx };
}
const P = (type: string, evidence: string[]): ActionProposal => ({
  npcId: 'bram', type, params: { target: 'ash' }, evidence, rationale: '', tier: 'utility',
});

describe('support: combined certainty about someone', () => {
  it('combines independent observations; the same event counts once', () => {
    const w = new GameWorld();
    const mem = new MemoryStore('bram', policy);
    const e1 = w.emit({ type: 'theft', actor: 'ash', target: 'x', pos: { x: 0, z: 0 } });
    const e2 = w.emit({ type: 'theft', actor: 'ash', target: 'y', pos: { x: 0, z: 0 } });
    mem.inject({ kind: 'theft', subject: 'ash', tick: 0, summary: 's', evidence: [e1.id], confidence: 0.5 });
    expect(support(mem, 'ash')).toBeCloseTo(0.5);
    mem.inject({ kind: 'theft', subject: 'ash', tick: 0, summary: 's', evidence: [e1.id], confidence: 0.5 });
    expect(support(mem, 'ash')).toBeCloseTo(0.5);
    mem.inject({ kind: 'theft', subject: 'ash', tick: 0, summary: 's', evidence: [e2.id], confidence: 0.5 });
    expect(support(mem, 'ash')).toBeCloseTo(0.75);
  });
});

describe('verify: evidence proportional to irreversibility', () => {
  it('an alarm (irreversible) needs high certainty', () => {
    const lo = scene(0.5);
    const v = verify(P('call_guard', ['near:ash', lo.m.id]), lo.facts, lo.mem, ok, { proportionate: true });
    expect(v.proportionate).toBe(false);
    expect(v.ok).toBe(false);
    expect(v.issues.join(' ')).toMatch(/disproportionate/);
    const hi = scene(0.95);
    expect(verify(P('call_guard', ['near:ash', hi.m.id]), hi.facts, hi.mem, ok, { proportionate: true }).ok).toBe(true);
  });

  it('a coin-flip suspicion (0.5) does not justify a consequential act; more likely than not does', () => {
    const coin = scene(0.5);
    const sour = { ...P('adjust_relationship', ['rel:bram:ash', coin.m.id]), params: { target: 'ash', delta: -10 } };
    expect(verify(sour, coin.facts, coin.mem, ok, { proportionate: true }).proportionate).toBe(false);
    const likely = scene(0.6);
    expect(verify({ ...sour, evidence: ['rel:bram:ash', likely.m.id] }, likely.facts, likely.mem, ok, { proportionate: true }).proportionate).toBe(true);
  });

  it('a reversible probe needs none', () => {
    const lo = scene(0.3);
    expect(verify(P('inquire', ['near:ash', lo.m.id]), lo.facts, lo.mem, ok, { proportionate: true }).ok).toBe(true);
  });

  it('is off unless enabled (prototype behind a switch)', () => {
    const lo = scene(0.5);
    expect(verify(P('call_guard', ['near:ash', lo.m.id]), lo.facts, lo.mem, ok).proportionate).toBe(true);
  });
});

describe('utility: unsure NPCs probe instead of acting', () => {
  it('a guard unsure who stole inquires; a sure one raises the alarm', () => {
    const lo = scene(0.5);
    const top = (c: ReturnType<typeof scene>['ctx'], proportionate: boolean) =>
      utilityCandidates({ ...c, proportionate }).find((x) => x.proposal.type === 'call_guard' || x.proposal.type === 'inquire')!.proposal;
    const probe = top(lo.ctx, true);
    expect(probe.type).toBe('inquire');
    expect(probe.rationale).toMatch(/sure/);
    expect(top(scene(0.95).ctx, true).type).toBe('call_guard');
    expect(top(lo.ctx, false).type).toBe('call_guard'); // previous behaviour when off
  });
});
