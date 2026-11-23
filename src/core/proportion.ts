// Proportionate autonomy: the certainty an action needs scales with how hard it is to undo.
// Reversible acts need none; consequential ones need a likely culprit; irreversible ones need
// near-certainty. Below the bar, NPCs probe (inquire) instead of acting.
import type { ActionProposal, ActionType } from './types';

export type Reversibility = 'reversible' | 'consequential' | 'irreversible';

export const REVERSIBILITY: Record<ActionType, Reversibility> = {
  idle: 'reversible',
  greet: 'reversible',
  offer_trade: 'reversible',
  offer_quest: 'reversible',
  move_to: 'reversible',
  flee: 'reversible', // self-protective and undone by walking back
  inquire: 'reversible',
  pledge: 'consequential', // binds the NPC's own future offers
  refuse_trade: 'consequential',
  adjust_relationship: 'consequential',
  call_guard: 'irreversible',
};

export const REQUIRED_CERTAINTY: Record<Reversibility, number> = {
  reversible: 0,
  consequential: 0.5,
  irreversible: 0.8,
};

const ACCUSING = new Set<string>(['refuse_trade', 'call_guard', 'adjust_relationship']);

/** Certainty that must be *exceeded* about the target's culpability (0 = no accusation involved). */
export function requiredCertainty(p: ActionProposal): number {
  const level = REVERSIBILITY[p.type as ActionType];
  if (!level || !ACCUSING.has(p.type) || typeof p.params.target !== 'string') return 0;
  if (p.type === 'adjust_relationship' && Number(p.params.delta) > 0) return 0;
  return REQUIRED_CERTAINTY[level];
}
