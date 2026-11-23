// A simulated model tier with LLM-typical failure modes, seeded for reproducibility.
// Most of the time it proposes what a competent planner would; at rate `errorRate` it
// makes one of the documented failure classes: inventing items, overreaching rules,
// citing things that aren't true, acting on stale memories, contradicting its memories.
import { utilityCandidates, type ModelDecider } from '../src/core/decide';
import type { ActionProposal } from '../src/core/types';

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const FAILURE_MODES = [
  'invent_item',
  'out_of_zone',
  'over_discount',
  'fabricated_citation',
  'stale_memory',
  'discount_to_adversary',
  'hostility_without_cause',
] as const;

export function noisyModel(seed: number, errorRate: number): ModelDecider {
  const r = rng(seed);
  return {
    propose: async (ctx) => {
      const best = utilityCandidates(ctx)[0]!.proposal;
      const base: ActionProposal = { ...best, params: { ...best.params }, evidence: [...best.evidence], tier: 'model' };
      if (r() >= errorRate) return base;
      const focus = ctx.focus ?? 'player';
      const near = `near:${focus}`;
      const mode = FAILURE_MODES[Math.floor(r() * FAILURE_MODES.length)]!;
      const mk = (type: string, params: ActionProposal['params'], evidence: string[]): ActionProposal => ({
        npcId: ctx.npcId, type, params, evidence, rationale: `noisy:${mode}`, tier: 'model',
      });
      switch (mode) {
        case 'invent_item':
          return mk('offer_trade', { target: focus, item: 'excalibur', discount: 0 }, [near]);
        case 'out_of_zone':
          return mk('move_to', { x: ctx.role.zone.center.x + 50, z: ctx.role.zone.center.z }, []);
        case 'over_discount':
          return mk('offer_trade', { target: focus, item: 'potion', discount: 95 }, [near]);
        case 'fabricated_citation':
          return mk('greet', { target: focus }, [`${ctx.npcId}:m9999`, 'quest:the-kings-favour']);
        case 'stale_memory': {
          // cites any stored memory about the focus, valid or not, as grounds for hostility
          const m = ctx.memory.all().find((x) => x.subject === focus && x.valence < 0) ?? ctx.memory.all()[0];
          return m ? mk('refuse_trade', { target: focus }, [near, m.id]) : base;
        }
        case 'discount_to_adversary':
          return mk('offer_trade', { target: focus, item: 'bread', discount: 20 }, [near, `inv:${ctx.npcId}:bread`]);
        case 'hostility_without_cause':
          return mk('refuse_trade', { target: focus }, [near]);
      }
    },
  };
}
