// Builds the fact set an NPC may reason over, straight from authoritative game state
// and filtered by the designer's knowledge policy. Fact ids are stable citation keys.
import { deriveContracts } from './contracts';
import type { Fact, FactSet, KnowledgePolicy } from './types';
import type { GameWorld } from './world';

export function groundFacts(world: GameWorld, npcId: string, policy: KnowledgePolicy): FactSet {
  const facts = new Map<string, Fact>();
  const put = (f: Fact) => facts.set(f.id, f);
  const knows = new Set(policy.categories);
  const self = world.getEntity(npcId);

  if (knows.has('inventory')) {
    for (const [item, qty] of Object.entries(world.inventory(npcId)))
      put({ id: `inv:${npcId}:${item}`, kind: 'inventory', subject: item, value: qty });
  }
  if (knows.has('prices')) {
    for (const def of world.itemDefs()) put({ id: `price:${def.id}`, kind: 'price', subject: def.id, value: def.basePrice });
  }
  if (knows.has('quests')) {
    for (const q of world.quests()) put({ id: `quest:${q.id}`, kind: 'quest', subject: q.giver, value: q.status });
  }
  if (knows.has('commitments')) {
    for (const c of deriveContracts(world)) {
      if (c.kind === 'pledge' && c.debtor === npcId) {
        if (c.status === 'open') put({ id: `pledge:${c.id}`, kind: 'pledge', subject: c.creditor, value: c.discount ?? 0 });
        if (c.for) put({ id: `rewarded:${c.for}`, kind: 'commitment', subject: c.creditor, value: c.id });
      }
      if (c.kind === 'promise' && c.creditor === npcId && c.status === 'open')
        put({ id: `owed:${c.id}`, kind: 'commitment', subject: c.debtor, value: `${c.qty} ${c.item} by t${c.due}` });
    }
  }
  if (knows.has('gold')) put({ id: `gold:${npcId}`, kind: 'gold', subject: npcId, value: world.gold(npcId) });
  if (self && (knows.has('nearby') || knows.has('relationships'))) {
    for (const e of world.entities()) {
      if (e.id === npcId) continue;
      const d = Math.hypot(e.pos.x - self.pos.x, e.pos.z - self.pos.z);
      if (d > policy.perceptionRadius) continue;
      if (knows.has('nearby')) put({ id: `near:${e.id}`, kind: 'nearby', subject: e.id, value: round2(d) });
      if (knows.has('relationships'))
        put({ id: `rel:${npcId}:${e.id}`, kind: 'relationship', subject: e.id, value: world.relationship(npcId, e.id) });
    }
  }
  return facts;
}

const round2 = (v: number) => Math.round(v * 100) / 100;
