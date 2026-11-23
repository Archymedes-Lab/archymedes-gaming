import { describe, expect, it } from 'vitest';
import { GameActionAPI } from '../../src/core/actions';
import { GameWorld } from '../../src/core/world';
import type { ActionProposal, RoleSpec } from '../../src/core/types';

const merchant: RoleSpec = {
  role: 'merchant',
  allowed: ['idle', 'greet', 'offer_trade', 'refuse_trade', 'flee', 'move_to', 'adjust_relationship'],
  zone: { center: { x: 0, z: 0 }, radius: 4 },
  maxDiscount: 30,
  maxRelationshipDelta: 10,
  cooldowns: { adjust_relationship: 3 },
};
const giver: RoleSpec = { ...merchant, role: 'elder', allowed: ['idle', 'offer_quest'] };

function setup() {
  const w = new GameWorld();
  w.defineItem({ id: 'potion', name: 'Potion', basePrice: 10 });
  w.defineItem({ id: 'sword', name: 'Sword', basePrice: 50 });
  w.addEntity({ id: 'p', kind: 'player', name: 'Ash', pos: { x: 2, z: 0 }, faction: 't' });
  w.addEntity({ id: 'm', kind: 'npc', name: 'Mira', pos: { x: 0, z: 0 }, faction: 'v' });
  w.addEntity({ id: 'e', kind: 'npc', name: 'Elda', pos: { x: 0, z: 0 }, faction: 'v' });
  w.setItem('m', 'potion', 2);
  w.addQuest({ id: 'q1', title: 'Caravan', giver: 'e', status: 'available' });
  w.addQuest({ id: 'q2', title: 'Done', giver: 'e', status: 'completed' });
  return { w, api: new GameActionAPI(w, { m: merchant, e: giver }) };
}

const P = (over: Partial<ActionProposal>): ActionProposal => ({
  npcId: 'm', type: 'idle', params: {}, evidence: [], rationale: '', tier: 'utility', ...over,
});

function codes(api: GameActionAPI, p: ActionProposal) {
  return api.validate(p).violations.map((v) => v.code);
}

describe('GameActionAPI (hard boundary)', () => {
  it('accepts a legal trade offer', () => {
    const { api } = setup();
    expect(api.validate(P({ type: 'offer_trade', params: { target: 'p', item: 'potion', discount: 10 } })).ok).toBe(true);
  });

  it('rejects actions that do not exist or the role may not take', () => {
    const { api } = setup();
    expect(codes(api, P({ type: 'give_legendary_sword' }))).toContain('unknown_action');
    expect(codes(api, P({ type: 'call_guard', params: { target: 'p' } }))).toContain('not_permitted');
    expect(codes(api, P({ npcId: 'ghost' }))).toContain('not_permitted');
  });

  it('rejects invented items and items the NPC does not hold', () => {
    const { api } = setup();
    expect(codes(api, P({ type: 'offer_trade', params: { target: 'p', item: 'excalibur', discount: 0 } }))).toContain('unknown_item');
    expect(codes(api, P({ type: 'offer_trade', params: { target: 'p', item: 'sword', discount: 0 } }))).toContain('not_in_inventory');
  });

  it('rejects discounts and relationship changes beyond designer bounds', () => {
    const { api } = setup();
    expect(codes(api, P({ type: 'offer_trade', params: { target: 'p', item: 'potion', discount: 90 } }))).toContain('param_out_of_range');
    expect(codes(api, P({ type: 'adjust_relationship', params: { target: 'p', delta: 50 } }))).toContain('param_out_of_range');
  });

  it('rejects movement outside the NPC zone', () => {
    const { api } = setup();
    expect(codes(api, P({ type: 'move_to', params: { x: 20, z: 0 } }))).toContain('out_of_bounds');
    expect(api.validate(P({ type: 'move_to', params: { x: 3, z: 0 } })).ok).toBe(true);
  });

  it('rejects unknown targets and malformed params', () => {
    const { api } = setup();
    expect(codes(api, P({ type: 'greet', params: { target: 'nobody' } }))).toContain('unknown_target');
    expect(codes(api, P({ type: 'move_to', params: { x: 'left' } }))).toContain('bad_params');
  });

  it('only lets the quest giver offer an available quest', () => {
    const { api } = setup();
    const ok = P({ npcId: 'e', type: 'offer_quest', params: { target: 'p', quest: 'q1' } });
    expect(api.validate(ok).ok).toBe(true);
    expect(codes(api, { ...ok, params: { target: 'p', quest: 'q2' } })).toContain('quest_unavailable');
    expect(codes(api, { ...ok, params: { target: 'p', quest: 'qX' } })).toContain('unknown_quest');
  });

  it('executes effects only through the engine and only when valid', () => {
    const { w, api } = setup();
    const bad = api.execute(P({ type: 'adjust_relationship', params: { target: 'p', delta: 99 } }));
    expect(bad.ok).toBe(false);
    expect(w.relationship('m', 'p')).toBe(0);
    const good = api.execute(P({ type: 'adjust_relationship', params: { target: 'p', delta: 5 } }));
    expect(good.ok).toBe(true);
    expect(w.relationship('m', 'p')).toBe(5);
  });

  it('enforces cooldowns', () => {
    const { w, api } = setup();
    const adj = P({ type: 'adjust_relationship', params: { target: 'p', delta: 1 } });
    expect(api.execute(adj).ok).toBe(true);
    expect(codes(api, adj)).toContain('cooldown');
    w.advance(); w.advance(); w.advance();
    expect(api.validate(adj).ok).toBe(true);
  });

  it('move_to and flee keep the NPC inside its zone', () => {
    const { w, api } = setup();
    api.execute(P({ type: 'move_to', params: { x: 3, z: 1 } }));
    expect(w.getEntity('m')?.pos).toEqual({ x: 3, z: 1 });
    api.execute(P({ type: 'flee', params: { target: 'p' } }));
    const pos = w.getEntity('m')!.pos;
    expect(Math.hypot(pos.x, pos.z)).toBeLessThanOrEqual(4 + 1e-9);
  });
});
