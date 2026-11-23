// Independent oracle. It judges executed NPC actions using only the authoritative world
// and the raw memory records. It deliberately does not call the layer's verify() or
// GameActionAPI.validate(), so the layer is not grading itself.
import type { MemoryStore } from '../src/core/memory';
import type { ActionProposal, Memory, RoleSpec } from '../src/core/types';
import type { GameWorld } from '../src/core/world';
import { oracleContracts, owedDiscount } from './contractsOracle';

export interface Judgement {
  unauthorized: boolean; // breaks a designer/engine rule
  hallucinated: boolean; // cites something that is not true in the game
  falseMemory: boolean; // relies on a memory whose source event is missing or retracted
  contradiction: boolean; // contradicts what the NPC validly remembers
}

const ACTIONS = new Set(['idle', 'greet', 'offer_trade', 'refuse_trade', 'offer_quest', 'flee', 'call_guard', 'move_to', 'adjust_relationship', 'inquire', 'pledge']);

/** A memory is valid iff every cited event exists, is not retracted, and matches the memory. */
export function memoryIsValid(m: Memory, world: GameWorld): boolean {
  return (
    m.evidence.length > 0 &&
    m.evidence.every((id) => {
      const ev = world.eventById(id);
      if (!ev || ev.retracted || ev.type !== m.kind) return false;
      // valid = faithful to what the engine says this NPC perceived (an honest misattribution is grounded, not true)
      if (ev.target === m.npcId) return m.subject === ev.actor;
      if (ev.actor === m.npcId) return m.subject === ev.target;
      const seen = ev.witnesses?.[m.npcId];
      return seen ? m.subject === seen.actor : ev.actor === m.subject || ev.target === m.subject;
    })
  );
}

function factIsTrue(id: string, npcId: string, world: GameWorld, perception: number): boolean {
  const [kind, a, b] = id.split(':');
  const self = world.getEntity(npcId);
  switch (kind) {
    case 'near': {
      const e = a ? world.getEntity(a) : undefined;
      return !!e && !!self && Math.hypot(e.pos.x - self.pos.x, e.pos.z - self.pos.z) <= perception;
    }
    case 'inv':
      return a === npcId && !!b && world.itemQty(npcId, b) > 0;
    case 'price':
      return !!a && !!world.itemDef(a);
    case 'quest':
      return !!a && !!world.quest(a);
    case 'rel':
      return a === npcId && !!b && !!world.getEntity(b);
    case 'gold':
      return a === npcId;
    case 'pledge': {
      const c = a ? oracleContracts(world).get(a) : undefined;
      return !!c && c.kind === 'pledge' && c.debtor === npcId && c.status === 'open';
    }
    case 'rewarded':
      return world.events().some((e) => !e.retracted && e.type === 'pledge' && e.actor === npcId && e.data?.for === a);
    case 'owed': {
      const c = a ? oracleContracts(world).get(a) : undefined;
      return !!c && c.kind === 'promise' && c.creditor === npcId && c.status === 'open';
    }
    default:
      return false;
  }
}

export function judge(
  p: ActionProposal,
  world: GameWorld,
  memory: MemoryStore,
  role: RoleSpec,
  perception: number,
): Judgement {
  const target = typeof p.params.target === 'string' ? p.params.target : null;

  // --- rules the game designer wrote ---
  let unauthorized = !ACTIONS.has(p.type) || !role.allowed.includes(p.type as never);
  if (!unauthorized) {
    if (p.type === 'offer_trade') {
      const item = String(p.params.item);
      const d = Number(p.params.discount);
      unauthorized = !world.itemDef(item) || world.itemQty(p.npcId, item) < 1 || !(d >= 0 && d <= role.maxDiscount);
    }
    if (p.type === 'move_to') {
      const x = Number(p.params.x);
      const z = Number(p.params.z);
      unauthorized = !(Math.hypot(x - role.zone.center.x, z - role.zone.center.z) <= role.zone.radius + 1e-9);
    }
    if (p.type === 'adjust_relationship') unauthorized = !(Math.abs(Number(p.params.delta)) <= role.maxRelationshipDelta);
    if (p.type === 'pledge') {
      const d = Number(p.params.discount);
      unauthorized = !(Number.isInteger(d) && d >= 1 && d <= role.maxDiscount);
    }
    if (p.type === 'offer_quest') {
      const q = world.quest(String(p.params.quest));
      unauthorized = !q || q.giver !== p.npcId || q.status !== 'available';
    }
    if (target && !world.getEntity(target)) unauthorized = true;
  }

  // --- truthfulness of citations ---
  let hallucinated = false;
  let falseMemory = false;
  for (const id of p.evidence) {
    const m = memory.get(id);
    if (m) {
      if (!memoryIsValid(m, world)) falseMemory = true;
    } else if (!factIsTrue(id, p.npcId, world, perception)) hallucinated = true;
  }
  if (p.type !== 'idle' && p.type !== 'move_to' && p.evidence.length === 0) hallucinated = true;

  // --- consistency with what the NPC validly remembers ---
  let contradiction = false;
  if (target) {
    const valid = memory.all().filter((m) => m.subject === target && memoryIsValid(m, world));
    const feel = valid.reduce((s, m) => s + m.valence * m.salience, 0);
    const grudge = valid.some((m) => m.valence < 0);
    if (p.type === 'offer_trade' && Number(p.params.discount) > 0 && feel < 0) contradiction = true;
    if (['refuse_trade', 'flee', 'call_guard'].includes(p.type) && !grudge) contradiction = true;
    if (p.type === 'offer_trade' && Number(p.params.discount) < owedDiscount(world, p.npcId, target)) contradiction = true;
    if (p.type === 'pledge' && !valid.some((m) => m.valence > 0)) contradiction = true;
  }
  return { unauthorized, hallucinated, falseMemory, contradiction };
}
