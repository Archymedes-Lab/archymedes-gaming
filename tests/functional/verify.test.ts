import { describe, expect, it } from 'vitest';
import { verify } from '../../src/core/verify';
import { MemoryStore } from '../../src/core/memory';
import { GameWorld } from '../../src/core/world';
import type { ActionProposal, Fact, MemoryPolicy } from '../../src/core/types';

const policy: MemoryPolicy = {
  capacity: 10, forgetBelow: 0.01, perceptionRadius: 8,
  rules: { theft: { salience: 0.9, valence: -1, halfLife: 100 }, rescue: { salience: 0.9, valence: 1, halfLife: 100 } },
};
const facts = new Map<string, Fact>([
  ['near:p', { id: 'near:p', kind: 'nearby', subject: 'p', value: 2 }],
  ['inv:m:potion', { id: 'inv:m:potion', kind: 'inventory', subject: 'potion', value: 3 }],
]);
const ok = { ok: true, violations: [] };
const P = (over: Partial<ActionProposal>): ActionProposal => ({
  npcId: 'm', type: 'greet', params: { target: 'p' }, evidence: ['near:p'], rationale: '', tier: 'utility', ...over,
});

function store() {
  const w = new GameWorld();
  const mem = new MemoryStore('m', policy);
  const theft = mem.observe(w.emit({ type: 'theft', actor: 'p', target: 'm', pos: { x: 0, z: 0 } }), { x: 0, z: 0 })!;
  return { w, mem, theft };
}

describe('verify', () => {
  it('passes a grounded, permitted, consistent proposal', () => {
    const { mem } = store();
    const v = verify(P({}), facts, mem, ok);
    expect(v).toMatchObject({ grounded: true, permitted: true, consistent: true, ok: true });
  });

  it('flags evidence that does not resolve to a fact or active memory', () => {
    const { mem } = store();
    expect(verify(P({ evidence: ['near:p', 'made-up'] }), facts, mem, ok).grounded).toBe(false);
    expect(verify(P({ evidence: [] }), facts, mem, ok).grounded).toBe(false);
    expect(verify(P({ type: 'idle', params: {}, evidence: [] }), facts, mem, ok).grounded).toBe(true);
  });

  it('flags citations of corrected memories as ungrounded', () => {
    const { w, mem, theft } = store();
    w.retract(theft.evidence[0]!);
    mem.reconcile(w);
    const v = verify(P({ type: 'refuse_trade', evidence: ['near:p', theft.id] }), facts, mem, ok);
    expect(v.grounded).toBe(false);
  });

  it('flags contradictions: discount to an adversary, refusal without cause', () => {
    const { mem } = store();
    const discount = P({ type: 'offer_trade', params: { target: 'p', item: 'potion', discount: 20 }, evidence: ['near:p', 'inv:m:potion'] });
    expect(verify(discount, facts, mem, ok).consistent).toBe(false);
    const fresh = new MemoryStore('m', policy);
    const refuse = P({ type: 'refuse_trade', params: { target: 'p' }, evidence: ['near:p'] });
    expect(verify(refuse, facts, fresh, ok).consistent).toBe(false);
  });

  it('carries engine violations into the verdict', () => {
    const { mem } = store();
    const v = verify(P({}), facts, mem, { ok: false, violations: [{ code: 'not_permitted', detail: 'x' }] });
    expect(v.permitted).toBe(false);
    expect(v.ok).toBe(false);
    expect(v.issues.join(' ')).toMatch(/not_permitted/);
  });
});
