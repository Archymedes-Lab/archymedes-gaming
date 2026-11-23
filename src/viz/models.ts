// Stand-ins for an external model tier, used to show the boundary and the fallback live.
import type { ModelDecider } from '../core/decide';
import type { ActionProposal } from '../core/types';
import { PLAYER, QUEST_CARAVAN } from '../game/village';

type Draft = Omit<ActionProposal, 'npcId' | 'tier'>;

const FORBIDDEN: Draft[] = [
  { type: 'offer_trade', params: { target: PLAYER, item: 'excalibur', discount: 0 }, evidence: [`near:${PLAYER}`], rationale: 'sell the legendary Excalibur!' },
  { type: 'complete_quest', params: { quest: QUEST_CARAVAN }, evidence: [`near:${PLAYER}`], rationale: 'just mark the quest done' },
  { type: 'move_to', params: { x: 30, z: -25 }, evidence: [], rationale: 'wander off to the mountains' },
  { type: 'offer_trade', params: { target: PLAYER, item: 'potion', discount: 90 }, evidence: [`near:${PLAYER}`], rationale: '90% off, why not' },
  { type: 'greet', params: { target: PLAYER }, evidence: ['memory:you-saved-the-king'], rationale: 'you saved the king (did they?)' },
  { type: 'adjust_relationship', params: { target: PLAYER, delta: 60 }, evidence: [`rel:x:${PLAYER}`], rationale: 'best friends forever' },
  { type: 'spawn_item', params: { item: 'dragon_egg' }, evidence: [], rationale: 'conjure loot' },
];

/** A model that hallucinates and over-reaches every time it is asked. */
export function rogueModel(): ModelDecider {
  let i = 0;
  return {
    propose: async (ctx) => {
      await new Promise((r) => setTimeout(r, 15 + (i % 3) * 10));
      const d = FORBIDDEN[i++ % FORBIDDEN.length]!;
      return { ...d, params: { ...d.params }, npcId: ctx.npcId, tier: 'model' };
    },
  };
}

/** A model behind a network that is down: never answers within budget. */
export function slowModel(delayMs = 2500): ModelDecider {
  return {
    propose: (ctx, signal) =>
      new Promise((resolve) => {
        const t = setTimeout(() => resolve({ npcId: ctx.npcId, type: 'idle', params: {}, evidence: [], rationale: 'late', tier: 'model' }), delayMs);
        signal.addEventListener('abort', () => clearTimeout(t));
      }),
  };
}
