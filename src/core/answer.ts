// Grounded Q&A: every answer is derived from facts or active memories and cites them.
// When neither covers the question, the NPC says it does not know.
import type { Answer, FactSet, Question } from './types';
import type { MemoryStore } from './memory';
import type { GameWorld } from './world';

const unknown = (text: string): Answer => ({ known: false, text, citations: [] });

export function answer(q: Question, facts: FactSet, memory: MemoryStore, world?: GameWorld): Answer {
  const name = (id: string) => world?.getEntity(id)?.name ?? world?.itemDef(id)?.name ?? id;
  switch (q.type) {
    case 'has_item': {
      const inv = facts.get(`inv:${memory.npcId}:${q.item}`);
      if (inv && Number(inv.value) > 0)
        return { known: true, text: `Yes, I have ${inv.value} ${name(q.item)}.`, citations: [inv.id] };
      const price = facts.get(`price:${q.item}`);
      if (price) return { known: true, text: `No, ${name(q.item)} is out of stock.`, citations: [price.id] };
      return unknown(`I've never heard of "${q.item}".`);
    }
    case 'price': {
      const price = facts.get(`price:${q.item}`);
      return price
        ? { known: true, text: `${name(q.item)} costs ${price.value} gold.`, citations: [price.id] }
        : unknown(`I don't know a price for "${q.item}".`);
    }
    case 'quest_status': {
      const f = facts.get(`quest:${q.quest}`);
      return f
        ? { known: true, text: `That quest is ${f.value}.`, citations: [f.id] }
        : unknown(`I don't know anything about that quest.`);
    }
    case 'remember': {
      const ms = memory.recall({ subject: q.subject, limit: 3 });
      if (ms.length === 0) return unknown(`I don't recall anything about ${name(q.subject)}.`);
      const lines = ms.map((m) => describe(m.kind, name(m.subject)));
      return { known: true, text: `I remember ${lines.join('; ')}.`, citations: ms.map((m) => m.id) };
    }
  }
}

function describe(kind: string, who: string): string {
  switch (kind) {
    case 'rescue': return `${who} rescued my caravan`;
    case 'theft': return `${who} stole from me`;
    case 'gift': return `${who} gave me a gift`;
    case 'attack': return `${who} attacked me`;
    case 'promise': return `${who} made me a promise`;
    case 'greeting': return `${who} greeted me`;
    default: return `${who} and a ${kind}`;
  }
}
