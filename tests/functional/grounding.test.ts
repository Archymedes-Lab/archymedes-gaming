import { describe, expect, it } from 'vitest';
import { groundFacts } from '../../src/core/grounding';
import { answer } from '../../src/core/answer';
import { MemoryStore } from '../../src/core/memory';
import { GameWorld } from '../../src/core/world';
import type { KnowledgePolicy, MemoryPolicy } from '../../src/core/types';

function world() {
  const w = new GameWorld();
  w.defineItem({ id: 'potion', name: 'Potion', basePrice: 10 });
  w.defineItem({ id: 'sword', name: 'Sword', basePrice: 50 });
  w.addEntity({ id: 'p', kind: 'player', name: 'Ash', pos: { x: 2, z: 0 }, faction: 't' });
  w.addEntity({ id: 'far', kind: 'player', name: 'Far', pos: { x: 50, z: 0 }, faction: 't' });
  w.addEntity({ id: 'm', kind: 'npc', name: 'Mira', pos: { x: 0, z: 0 }, faction: 'v' });
  w.addEntity({ id: 'o', kind: 'npc', name: 'Other', pos: { x: 0, z: 0 }, faction: 'v' });
  w.setItem('m', 'potion', 4);
  w.setItem('o', 'sword', 1);
  w.addQuest({ id: 'q1', title: 'Caravan', giver: 'o', status: 'available' });
  return w;
}

const full: KnowledgePolicy = {
  categories: ['inventory', 'prices', 'quests', 'relationships', 'nearby', 'gold'],
  perceptionRadius: 8,
};

const memPolicy: MemoryPolicy = {
  capacity: 10,
  forgetBelow: 0.01,
  perceptionRadius: 8,
  rules: { rescue: { salience: 0.9, valence: 1, halfLife: 1000 }, theft: { salience: 0.9, valence: -1, halfLife: 1000 } },
};

describe('groundFacts', () => {
  it('exposes only the NPC own inventory, never other NPCs stock', () => {
    const f = groundFacts(world(), 'm', full);
    expect(f.get('inv:m:potion')?.value).toBe(4);
    expect([...f.keys()].some((k) => k.startsWith('inv:o:'))).toBe(false);
  });

  it('lists nearby entities within perception radius only', () => {
    const f = groundFacts(world(), 'm', full);
    expect(f.has('near:p')).toBe(true);
    expect(f.has('near:far')).toBe(false);
    expect(f.has('near:m')).toBe(false);
  });

  it('respects the designer knowledge policy', () => {
    const f = groundFacts(world(), 'm', { categories: ['nearby'], perceptionRadius: 8 });
    expect([...f.values()].every((x) => x.kind === 'nearby')).toBe(true);
  });

  it('exposes quests and prices from authoritative state', () => {
    const f = groundFacts(world(), 'm', full);
    expect(f.get('quest:q1')?.value).toBe('available');
    expect(f.get('price:sword')?.value).toBe(50);
  });
});

describe('answer (grounded Q&A)', () => {
  it('answers inventory questions from game state with citations', () => {
    const w = world();
    const a = answer({ type: 'has_item', item: 'potion' }, groundFacts(w, 'm', full), new MemoryStore('m', memPolicy), w);
    expect(a.known).toBe(true);
    expect(a.text).toMatch(/4/);
    expect(a.citations).toContain('inv:m:potion');
  });

  it('says out of stock for a known item it does not hold', () => {
    const w = world();
    const a = answer({ type: 'has_item', item: 'sword' }, groundFacts(w, 'm', full), new MemoryStore('m', memPolicy), w);
    expect(a.known).toBe(true);
    expect(a.text.toLowerCase()).toMatch(/no|out of stock/);
  });

  it('never invents items that do not exist in the game', () => {
    const w = world();
    const a = answer({ type: 'has_item', item: 'excalibur' }, groundFacts(w, 'm', full), new MemoryStore('m', memPolicy), w);
    expect(a.known).toBe(false);
    expect(a.citations).toEqual([]);
  });

  it('answers what it remembers about someone, citing memories', () => {
    const w = world();
    const mem = new MemoryStore('m', memPolicy);
    const ev = w.emit({ type: 'rescue', actor: 'p', target: 'm', pos: { x: 0, z: 0 } });
    const m = mem.observe(ev, { x: 0, z: 0 })!;
    const a = answer({ type: 'remember', subject: 'p' }, groundFacts(w, 'm', full), mem, w);
    expect(a.known).toBe(true);
    expect(a.citations).toEqual([m.id]);
    expect(a.text.toLowerCase()).toMatch(/rescue/);
  });

  it('admits it does not know rather than guessing', () => {
    const w = world();
    const facts = groundFacts(w, 'm', { categories: ['nearby'], perceptionRadius: 8 });
    const a = answer({ type: 'quest_status', quest: 'q1' }, facts, new MemoryStore('m', memPolicy), w);
    expect(a.known).toBe(false);
  });
});
