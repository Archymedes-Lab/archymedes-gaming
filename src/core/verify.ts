// Verified behaviour: a proposal runs only if it is grounded (every citation resolves),
// permitted (the engine accepts it) and consistent (it does not contradict memory).
import { netValence, relationshipTarget, support } from './affect';
import { requiredCertainty } from './proportion';
import type { MemoryStore } from './memory';
import type { ActionProposal, ActionType, FactSet, Validation, Verdict } from './types';
import { EVIDENCE_EXEMPT } from './types';

export { support };

export interface VerifyOptions {
  /** Require certainty proportional to irreversibility (prototype; see docs/NEXT-INNOVATION.md). */
  proportionate?: boolean;
}

export function verify(
  p: ActionProposal,
  facts: FactSet,
  memory: MemoryStore,
  validation: Validation,
  opts: VerifyOptions = {},
): Verdict {
  const issues: string[] = [];

  let grounded = true;
  if (!EVIDENCE_EXEMPT.includes(p.type as ActionType) && p.evidence.length === 0) {
    grounded = false;
    issues.push('ungrounded: no evidence cited');
  }
  for (const id of p.evidence) {
    if (facts.has(id)) continue;
    const m = memory.get(id);
    if (m?.status === 'active') continue;
    grounded = false;
    issues.push(m ? `ungrounded: ${id} is a corrected memory` : `ungrounded: ${id} resolves to nothing`);
  }

  const permitted = validation.ok;
  for (const v of validation.violations) issues.push(`${v.code}: ${v.detail}`);

  let consistent = true;
  const target = typeof p.params.target === 'string' ? p.params.target : null;
  if (target) {
    const feel = netValence(memory, target);
    const hostile = memory.recall({ subject: target }).some((m) => m.valence < 0);
    const contradiction = (msg: string) => ((consistent = false), issues.push(`contradiction: ${msg}`));
    if (p.type === 'offer_trade' && Number(p.params.discount) > 0 && feel < 0)
      contradiction(`discount offered to ${target} despite negative memories`);
    if ((p.type === 'refuse_trade' || p.type === 'flee' || p.type === 'call_guard') && !hostile)
      contradiction(`${p.type} against ${target} with no negative memory`);
    // the NPC's own pledges bind it: no offer may undercut an open pledge to this player
    const owed = Math.max(0, ...[...facts.values()].filter((f) => f.kind === 'pledge' && f.subject === target).map((f) => Number(f.value)));
    if (p.type === 'offer_trade' && Number(p.params.discount) < owed)
      contradiction(`offer at ${Number(p.params.discount)}% breaks an open pledge of ${owed}% to ${target}`);
    if (p.type === 'pledge' && !memory.recall({ subject: target }).some((m) => m.valence > 0))
      contradiction(`pledge to ${target} with nothing to reward`);
    if (p.type === 'adjust_relationship') {
      const want = relationshipTarget(memory, target);
      const gap = want - (factValue(facts, target) ?? 0);
      if (gap === 0 || Math.sign(Number(p.params.delta)) !== Math.sign(gap))
        contradiction(`relationship change not justified by memories (target ${want})`);
    }
  }

  let proportionate = true;
  const need = opts.proportionate ? requiredCertainty(p) : 0;
  if (need > 0 && target) {
    const have = support(memory, target);
    if (!(have > need)) {
      proportionate = false;
      issues.push(`disproportionate: ${p.type} needs more than ${need.toFixed(2)} certainty about ${target}, have ${have.toFixed(2)}`);
    }
  }

  return { grounded, permitted, consistent, proportionate, ok: grounded && permitted && consistent && proportionate, issues };
}

function factValue(facts: FactSet, subject: string): number | undefined {
  for (const f of facts.values()) if (f.kind === 'relationship' && f.subject === subject) return Number(f.value);
  return undefined;
}
