import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/core/memory';
import { GameWorld } from '../../src/core/world';
import type { MemoryPolicy } from '../../src/core/types';

const policy: MemoryPolicy = {
  capacity: 3,
  forgetBelow: 0.05,
  perceptionRadius: 5,
  rules: {
    rescue: { salience: 0.9, valence: 1, halfLife: 1000 },
    theft: { salience: 0.8, valence: -1, halfLife: 500 },
    greeting: { salience: 0.2, valence: 0.1, halfLife: 10 },
  },
};

function setup() {
  const w = new GameWorld();
  w.addEntity({ id: 'p', kind: 'player', name: 'Player', pos: { x: 0, z: 0 }, faction: 't' });
  w.addEntity({ id: 'm', kind: 'npc', name: 'Mira', pos: { x: 0, z: 0 }, faction: 'v' });
  return { w, mem: new MemoryStore('m', policy) };
}

describe('MemoryStore', () => {
  it('remembers memorable events it is involved in, with the event as evidence', () => {
    const { w, mem } = setup();
    const ev = w.emit({ type: 'rescue', actor: 'p', target: 'm', pos: { x: 100, z: 100 } });
    const m = mem.observe(ev, { x: 0, z: 0 });
    expect(m).not.toBeNull();
    expect(m!.subject).toBe('p');
    expect(m!.evidence).toEqual([ev.id]);
    expect(m!.valence).toBe(1);
    expect(m!.status).toBe('active');
  });

  it('ignores event types the designer did not mark memorable', () => {
    const { w, mem } = setup();
    const ev = w.emit({ type: 'trade', actor: 'p', target: 'm', pos: { x: 0, z: 0 } });
    expect(mem.observe(ev, { x: 0, z: 0 })).toBeNull();
  });

  it('only remembers witnessed third-party events inside perception radius', () => {
    const { w, mem } = setup();
    const near = w.emit({ type: 'theft', actor: 'p', target: 'other', pos: { x: 3, z: 0 } });
    const far = w.emit({ type: 'theft', actor: 'p', target: 'other', pos: { x: 30, z: 0 } });
    expect(mem.observe(near, { x: 0, z: 0 })?.subject).toBe('p');
    expect(mem.observe(far, { x: 0, z: 0 })).toBeNull();
  });

  it('never stores the same event twice', () => {
    const { w, mem } = setup();
    const ev = w.emit({ type: 'rescue', actor: 'p', target: 'm', pos: { x: 0, z: 0 } });
    mem.observe(ev, { x: 0, z: 0 });
    expect(mem.observe(ev, { x: 0, z: 0 })).toBeNull();
    expect(mem.recall()).toHaveLength(1);
  });

  it('recalls by subject, most salient first', () => {
    const { w, mem } = setup();
    mem.observe(w.emit({ type: 'greeting', actor: 'p', target: 'm', pos: { x: 0, z: 0 } }), { x: 0, z: 0 });
    mem.observe(w.emit({ type: 'rescue', actor: 'p', target: 'm', pos: { x: 0, z: 0 } }), { x: 0, z: 0 });
    mem.observe(w.emit({ type: 'greeting', actor: 'q', target: 'm', pos: { x: 0, z: 0 } }), { x: 0, z: 0 });
    const r = mem.recall({ subject: 'p' });
    expect(r.map((m) => m.kind)).toEqual(['rescue', 'greeting']);
    expect(mem.recall({ subject: 'p', limit: 1 })).toHaveLength(1);
  });

  it('evicts the least salient memory when over capacity', () => {
    const { w, mem } = setup();
    const at = { x: 0, z: 0 };
    mem.observe(w.emit({ type: 'greeting', actor: 'p', target: 'm', pos: at }), at);
    mem.observe(w.emit({ type: 'rescue', actor: 'p', target: 'm', pos: at }), at);
    mem.observe(w.emit({ type: 'theft', actor: 'p', target: 'm', pos: at }), at);
    mem.observe(w.emit({ type: 'rescue', actor: 'q', target: 'm', pos: at }), at);
    expect(mem.all()).toHaveLength(3);
    expect(mem.recall().some((m) => m.kind === 'greeting')).toBe(false);
  });

  it('decays salience over time and forgets trivial memories but keeps significant ones', () => {
    const { w, mem } = setup();
    const at = { x: 0, z: 0 };
    mem.observe(w.emit({ type: 'greeting', actor: 'p', target: 'm', pos: at }), at);
    mem.observe(w.emit({ type: 'rescue', actor: 'p', target: 'm', pos: at }), at);
    const forgotten = mem.decayTo(100);
    expect(forgotten).toHaveLength(1);
    const left = mem.recall();
    expect(left.map((m) => m.kind)).toEqual(['rescue']);
    expect(left[0]!.salience).toBeLessThan(0.9);
    expect(left[0]!.salience).toBeGreaterThan(0.8);
  });

  it('reconcile corrects memories whose evidence the game no longer backs', () => {
    const { w, mem } = setup();
    const at = { x: 0, z: 0 };
    const ev = w.emit({ type: 'theft', actor: 'p', target: 'm', pos: at });
    const m = mem.observe(ev, at)!;
    w.retract(ev.id);
    expect(mem.reconcile(w)).toEqual([m.id]);
    expect(mem.get(m.id)?.status).toBe('corrected');
    expect(mem.recall()).toHaveLength(0);
  });

  it('reconcile corrects injected memories that cite fabricated or mismatched evidence', () => {
    const { w, mem } = setup();
    const real = w.emit({ type: 'gift', actor: 'q', target: 'm', pos: { x: 0, z: 0 } });
    const fake = mem.inject({ kind: 'theft', subject: 'p', tick: 0, summary: 'p stole', evidence: ['ev-999'] });
    const mismatch = mem.inject({ kind: 'theft', subject: 'p', tick: 0, summary: 'p stole', evidence: [real.id] });
    expect(mem.reconcile(w).sort()).toEqual([fake.id, mismatch.id].sort());
    expect(mem.get(fake.id)?.correctionReason).toMatch(/evidence/);
  });

  it('forget removes a memory entirely (designer / player right to be forgotten)', () => {
    const { w, mem } = setup();
    const m = mem.observe(w.emit({ type: 'rescue', actor: 'p', target: 'm', pos: { x: 0, z: 0 } }), { x: 0, z: 0 })!;
    expect(mem.forget(m.id)).toBe(true);
    expect(mem.get(m.id)).toBeUndefined();
    expect(mem.forget(m.id)).toBe(false);
  });

  it('round-trips through JSON and keeps issuing fresh ids', () => {
    const { w, mem } = setup();
    mem.observe(w.emit({ type: 'rescue', actor: 'p', target: 'm', pos: { x: 0, z: 0 } }), { x: 0, z: 0 });
    const copy = MemoryStore.fromJSON(JSON.parse(JSON.stringify(mem.toJSON())), policy);
    expect(copy.toJSON()).toEqual(mem.toJSON());
    const m2 = copy.observe(w.emit({ type: 'theft', actor: 'p', target: 'm', pos: { x: 0, z: 0 } }), { x: 0, z: 0 })!;
    expect(copy.all().filter((m) => m.id === m2.id)).toHaveLength(1);
  });

  it('normalises -0 valence so persistence is lossless (found by property test)', () => {
    const { mem } = setup();
    mem.inject({ kind: 'greeting', subject: 'p', tick: 0, summary: 's', evidence: ['ev-0'], valence: -0 });
    const copy = MemoryStore.fromJSON(JSON.parse(JSON.stringify(mem.toJSON())), policy);
    expect(copy.toJSON()).toEqual(mem.toJSON());
  });

  it('fromJSON rejects malformed data', () => {
    expect(() => MemoryStore.fromJSON({ version: 99 }, policy)).toThrow();
    expect(() => MemoryStore.fromJSON(null, policy)).toThrow();
  });
});
