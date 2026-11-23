import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/core/memory';
import { GameWorld } from '../../src/core/world';
import type { MemoryPolicy } from '../../src/core/types';

const policy: MemoryPolicy = {
  capacity: 10, forgetBelow: 0.01, perceptionRadius: 10,
  rules: { theft: { salience: 0.9, valence: -1, halfLife: 1000 } },
};

function world() {
  const w = new GameWorld();
  w.addEntity({ id: 'ash', kind: 'player', name: 'Ash', pos: { x: 0, z: 0 }, faction: 't' });
  w.addEntity({ id: 'rook', kind: 'player', name: 'Rook', pos: { x: 20, z: 20 }, faction: 't' });
  w.addEntity({ id: 'mira', kind: 'npc', name: 'Mira', pos: { x: 0, z: 1 }, faction: 'v' });
  w.addEntity({ id: 'bram', kind: 'npc', name: 'Bram', pos: { x: 8, z: 0 }, faction: 'w' });
  return w;
}
const theft = (w: GameWorld, actor = 'ash') =>
  w.emit({ type: 'theft', actor, target: 'mira', pos: { ...w.getEntity(actor)!.pos } });

describe('engine perception records (what each NPC saw)', () => {
  it('those involved know who it was', () => {
    const ev = theft(world());
    expect(ev.witnesses?.mira).toEqual({ actor: 'ash', confidence: 1 });
  });

  it('distant witnesses are less sure, nearer ones more', () => {
    const w = world();
    const far = theft(w).witnesses!.bram!;
    w.moveEntity('bram', { x: 2, z: 0 });
    const near = theft(w).witnesses!.bram!;
    expect(far.actor).toBe('ash');
    expect(far.confidence).toBeLessThan(near.confidence);
    expect(near.confidence).toBeLessThan(1);
  });

  it('a bystander next to the culprit makes a distant witness unsure, and it may blame the wrong one', () => {
    const w = world();
    w.moveEntity('rook', { x: 1.5, z: 0 }); // closer to Bram than Ash is
    const seen = theft(w).witnesses!.bram!;
    expect(seen.actor).toBe('rook');
    expect(seen.confidence).toBeLessThanOrEqual(0.5);
  });

  it('witness records survive save/load', () => {
    const w = world();
    theft(w);
    expect(GameWorld.fromJSON(JSON.parse(JSON.stringify(w.toJSON()))).toJSON()).toEqual(w.toJSON());
  });
});

describe('memories carry perceived identity and confidence', () => {
  it('stores who the NPC thinks did it, and how sure it is', () => {
    const w = world();
    w.moveEntity('rook', { x: 1.5, z: 0 });
    const ev = theft(w);
    const m = new MemoryStore('bram', policy).observe(ev, w.getEntity('bram')!.pos)!;
    expect(m.subject).toBe('rook');
    expect(m.confidence).toBeLessThanOrEqual(0.5);
  });

  it('reconcile keeps an honest mistake but corrects a forged identity', () => {
    const w = world();
    w.moveEntity('rook', { x: 1.5, z: 0 });
    const ev = theft(w);
    const mem = new MemoryStore('bram', policy);
    const honest = mem.observe(ev, w.getEntity('bram')!.pos)!;
    const forged = mem.inject({ kind: 'theft', subject: 'mira', tick: 0, summary: 'x', evidence: [ev.id] });
    expect(mem.reconcile(w)).toEqual([forged.id]);
    expect(mem.get(honest.id)?.status).toBe('active');
  });

  it('events without perception records (legacy) are trusted fully', () => {
    const w = new GameWorld();
    const ev = w.emit({ type: 'theft', actor: 'ash', target: 'x', pos: { x: 1, z: 0 } });
    expect(new MemoryStore('bram', policy).observe(ev, { x: 0, z: 0 })!.confidence).toBe(1);
  });

  it('old saves without confidence load as fully confident', () => {
    const w = world();
    const mem = new MemoryStore('mira', policy);
    mem.observe(theft(w), { x: 0, z: 1 });
    const json = mem.toJSON();
    for (const m of json.memories) delete (m as { confidence?: number }).confidence;
    expect(MemoryStore.fromJSON(json, policy).all()[0]!.confidence).toBe(1);
  });
});
