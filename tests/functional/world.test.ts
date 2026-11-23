import { describe, expect, it } from 'vitest';
import { GameWorld } from '../../src/core/world';

function world() {
  const w = new GameWorld();
  w.defineItem({ id: 'potion', name: 'Potion', basePrice: 10 });
  w.addEntity({ id: 'p', kind: 'player', name: 'Player', pos: { x: 0, z: 0 }, faction: 'travellers' });
  w.addEntity({ id: 'm', kind: 'npc', name: 'Mira', pos: { x: 1, z: 0 }, faction: 'village' });
  w.setItem('m', 'potion', 3);
  return w;
}

describe('GameWorld (authoritative engine state)', () => {
  it('emits events with sequential ids stamped with the current tick', () => {
    const w = world();
    w.advance();
    const a = w.emit({ type: 'gift', actor: 'p', target: 'm', pos: { x: 0, z: 0 } });
    const b = w.emit({ type: 'greeting', actor: 'p', target: 'm', pos: { x: 0, z: 0 } });
    expect(a.id).not.toEqual(b.id);
    expect(a.tick).toBe(1);
    expect(w.events().map((e) => e.id)).toEqual([a.id, b.id]);
  });

  it('retracting an event invalidates it as evidence but keeps the audit record', () => {
    const w = world();
    const e = w.emit({ type: 'theft', actor: 'p', target: 'm', pos: { x: 0, z: 0 } });
    expect(w.isValidEvidence(e.id)).toBe(true);
    w.retract(e.id);
    expect(w.isValidEvidence(e.id)).toBe(false);
    expect(w.eventById(e.id)?.retracted).toBe(true);
    expect(w.isValidEvidence('ev-does-not-exist')).toBe(false);
  });

  it('clamps relationships to [-100, 100]', () => {
    const w = world();
    w.adjustRelationship('m', 'p', 500);
    expect(w.relationship('m', 'p')).toBe(100);
    w.adjustRelationship('m', 'p', -1000);
    expect(w.relationship('m', 'p')).toBe(-100);
  });

  it('refuses inventory for undefined items and negative quantities', () => {
    const w = world();
    expect(() => w.setItem('m', 'excalibur', 1)).toThrow();
    expect(() => w.setItem('m', 'potion', -1)).toThrow();
    expect(w.itemQty('m', 'potion')).toBe(3);
    expect(w.itemQty('m', 'unknown')).toBe(0);
  });

  it('round-trips through JSON', () => {
    const w = world();
    w.addQuest({ id: 'q', title: 'Q', giver: 'm', status: 'available' });
    w.emit({ type: 'gift', actor: 'p', target: 'm', pos: { x: 0, z: 0 } });
    w.adjustRelationship('m', 'p', 7);
    w.advance();
    const copy = GameWorld.fromJSON(JSON.parse(JSON.stringify(w.toJSON())));
    expect(copy.toJSON()).toEqual(w.toJSON());
  });
});
