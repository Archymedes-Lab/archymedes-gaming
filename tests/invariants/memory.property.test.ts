import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/core/memory';
import { GameWorld } from '../../src/core/world';
import { EVENT_TYPES, type MemoryPolicy } from '../../src/core/types';

const policyArb: fc.Arbitrary<MemoryPolicy> = fc.record({
  capacity: fc.integer({ min: 1, max: 12 }),
  forgetBelow: fc.double({ min: 0, max: 0.3, noNaN: true }),
  perceptionRadius: fc.integer({ min: 0, max: 20 }),
  rules: fc.dictionary(
    fc.constantFrom(...EVENT_TYPES),
    fc.record({
      salience: fc.double({ min: 0, max: 1, noNaN: true }),
      valence: fc.double({ min: -1, max: 1, noNaN: true }),
      halfLife: fc.integer({ min: 1, max: 500 }),
    }),
  ),
});

const evArb = fc.record({
  type: fc.constantFrom(...EVENT_TYPES),
  actor: fc.constantFrom('p', 'q', 'm'),
  target: fc.constantFrom('p', 'q', 'm', 'r'),
  x: fc.integer({ min: -30, max: 30 }),
  dt: fc.integer({ min: 0, max: 50 }),
  retract: fc.boolean(),
});

describe('MemoryStore invariants', () => {
  it('capacity, salience bounds, uniqueness, groundedness and lossless persistence', () => {
    fc.assert(
      fc.property(policyArb, fc.array(evArb, { maxLength: 80 }), (policy, evs) => {
        const w = new GameWorld();
        const mem = new MemoryStore('m', policy);
        for (const e of evs) {
          for (let i = 0; i < e.dt; i++) w.advance();
          const ev = w.emit({ type: e.type, actor: e.actor, target: e.target, pos: { x: e.x, z: 0 } });
          mem.observe(ev, { x: 0, z: 0 });
          if (e.retract) w.retract(ev.id);
          mem.reconcile(w);
          mem.decayTo(w.tick);

          const all = mem.all();
          expect(all.length).toBeLessThanOrEqual(policy.capacity);
          expect(new Set(all.map((m) => m.id)).size).toBe(all.length);
          for (const m of all) {
            expect(m.salience).toBeGreaterThanOrEqual(0);
            expect(m.salience).toBeLessThanOrEqual(m.baseSalience + 1e-12);
          }
          for (const m of mem.recall()) {
            expect(m.status).toBe('active');
            expect(m.salience).toBeGreaterThanOrEqual(policy.forgetBelow);
            for (const id of m.evidence) expect(w.isValidEvidence(id)).toBe(true);
          }
          const recalled = mem.recall();
          for (let i = 1; i < recalled.length; i++) expect(recalled[i - 1]!.salience).toBeGreaterThanOrEqual(recalled[i]!.salience);
        }
        expect(MemoryStore.fromJSON(JSON.parse(JSON.stringify(mem.toJSON())), policy).toJSON()).toEqual(mem.toJSON());
      }),
      { numRuns: 200 },
    );
  });
});
