// Tiered, latency-aware decision runtime:
//   reflex  — scripted responses to urgent events (no inference)
//   model   — optional external decider (LLM, local model), bounded by a latency budget
//   utility — deterministic scoring over the designer's action catalog; always available
// Every candidate cites the facts and memories it relies on.
import { netValence, relationshipTarget, support } from './affect';
import { REQUIRED_CERTAINTY } from './proportion';
import type { MemoryStore } from './memory';
import type { ActionProposal, ActionType, CandidateScore, FactSet, FallbackReason, Rejection, RoleSpec } from './types';

export interface DecisionContext {
  npcId: string;
  role: RoleSpec;
  tick: number;
  facts: FactSet;
  memory: MemoryStore;
  focus: string | null;
  /** Prototype: scale required certainty with irreversibility and probe when unsure. */
  proportionate?: boolean;
  /** Prototype: reward kept promises with pledges and honour open pledges. */
  contracts?: boolean;
}

export interface Candidate {
  proposal: ActionProposal;
  score: number;
}

export interface Decision {
  proposal: ActionProposal;
  candidates: CandidateScore[];
  rejected?: Rejection[];
  fallbackReason?: FallbackReason;
  latencyMs: number;
}

export interface ModelDecider {
  propose(ctx: DecisionContext, signal: AbortSignal): Promise<ActionProposal | null>;
}

/** Engine validation + verification. A bare boolean is accepted; an object also explains rejections. */
export type Acceptor = (p: ActionProposal) => boolean | { ok: boolean; issues: string[] };

export interface RuntimeOptions {
  model?: ModelDecider;
  modelBudgetMs?: number;
  /** Router: only escalate to the model when this returns true. */
  useModel?: (ctx: DecisionContext) => boolean;
  now?: () => number;
}

const REFLEX_WINDOW = 5;
const ALARM_WINDOW = 20;
const HOSTILE_AFFINITY = -0.3;
const MIN_DISCOUNT = 5; // percent; below this goodwill is not worth a price change

export function idle(npcId: string, rationale: string, tier: ActionProposal['tier'] = 'utility'): ActionProposal {
  return { npcId, type: 'idle', params: {}, evidence: [], rationale, tier };
}

/** Scripted reactions that must not wait on inference. */
export function reflex(ctx: DecisionContext): ActionProposal | null {
  const { focus, memory, role, npcId } = ctx;
  if (!focus || !ctx.facts.has(`near:${focus}`)) return null;
  const attack = memory.recall({ subject: focus, kind: 'attack' }).find((m) => ctx.tick - m.tick <= REFLEX_WINDOW);
  if (!attack) return null;
  const type: ActionType | null = role.allowed.includes('flee')
    ? 'flee'
    : role.allowed.includes('call_guard')
      ? 'call_guard'
      : null;
  if (!type) return null;
  // an irreversible reflex on an uncertain culprit is left to the deliberate tiers, which can probe
  if (ctx.proportionate && type === 'call_guard' && !(support(memory, focus) > REQUIRED_CERTAINTY.irreversible)) return null;
  return {
    npcId,
    type,
    params: { target: focus },
    evidence: [attack.id, `near:${focus}`],
    rationale: `${focus} attacked me ${ctx.tick - attack.tick} ticks ago`,
    tier: 'reflex',
  };
}

export function utilityCandidates(ctx: DecisionContext): Candidate[] {
  const { npcId, role, facts, memory, focus, tick } = ctx;
  const can = (t: ActionType) => role.allowed.includes(t);
  const out: Candidate[] = [{ proposal: idle(npcId, 'nothing needs my attention'), score: 0.05 }];
  const add = (type: ActionType, score: number, params: ActionProposal['params'], evidence: string[], rationale: string) =>
    out.push({ proposal: { npcId, type, params, evidence, rationale, tier: 'utility' }, score: round3(score) });

  const near = focus ? facts.get(`near:${focus}`) : undefined;
  if (!focus || !near) return sortCandidates(out);

  const mems = memory.recall({ subject: focus });
  const pos = mems.filter((m) => m.valence > 0);
  const neg = mems.filter((m) => m.valence < 0);
  const feel = netValence(memory, focus);
  const relFact = facts.get(`rel:${npcId}:${focus}`);
  const affinity = clamp(feel + (relFact ? Number(relFact.value) / 200 : 0), -1, 1);

  if (can('greet'))
    add('greet', 0.3 + (pos.length ? 0.1 : 0), { target: focus }, [near.id, ...pos.slice(0, 1).map((m) => m.id)],
      pos.length ? `greeting ${focus}, whom I remember fondly` : `greeting ${focus}`);

  if (can('offer_trade') && affinity >= HOSTILE_AFFINITY) {
    const stock = [...facts.values()]
      .filter((f) => f.kind === 'inventory' && Number(f.value) > 0)
      .sort((a, b) => Number(b.value) - Number(a.value) || a.id.localeCompare(b.id));
    const item = stock[0];
    if (item) {
      const raw = Math.round(role.maxDiscount * Math.min(1, Math.max(0, feel)));
      const earned = raw >= MIN_DISCOUNT ? Math.min(role.maxDiscount, raw) : 0;
      const price = facts.get(`price:${item.subject}`);
      // open pledges bind the offer: never below what was promised
      const pledges = [...facts.values()].filter((f) => f.kind === 'pledge' && f.subject === focus);
      const owed = Math.max(0, ...pledges.map((f) => Number(f.value)));
      const discount = Math.max(earned, owed);
      // a discount is justified by the whole relationship, so it cites the grudges it outweighed too
      const why = earned > 0 ? [...pos, ...neg].map((m) => m.id) : [];
      const despite = neg.length ? `, despite: ${neg[0]!.summary}` : '';
      const rationale = owed >= earned && owed > 0
        ? `${discount}% off ${item.subject}, as I pledged`
        : discount > 0 ? `${discount}% off ${item.subject}: ${pos[0]!.summary}${despite}` : `offering ${item.subject} at list price`;
      add('offer_trade', 0.5 + 0.3 * Math.max(0, affinity) + (owed > 0 ? 0.25 : 0), { target: focus, item: item.subject, discount },
        [near.id, item.id, ...(price ? [price.id] : []), ...why, ...pledges.map((f) => f.id)], rationale);
    }
  }

  const certainty = support(memory, focus);
  const sureEnough = (need: number) => !ctx.proportionate || certainty > need; // strictly: a coin flip is not enough

  if (ctx.contracts && can('pledge')) {
    // reward a kept promise once, with a pledge the engine will hold the NPC to
    const kept = mems.find((m) => m.kind === 'promise_kept' && !facts.has(`rewarded:${m.evidence[0]}`));
    const openPledge = [...facts.values()].some((f) => f.kind === 'pledge' && f.subject === focus);
    if (kept && !openPledge) {
      const discount = Math.max(1, Math.round(role.maxDiscount * 0.66));
      add('pledge', 0.88, { target: focus, discount, for: kept.evidence[0]! }, [near.id, kept.id],
        `${focus} kept their word; I pledge ${discount}% off their next trade`);
    }
  }

  if (can('refuse_trade') && neg.length && affinity < HOSTILE_AFFINITY && sureEnough(REQUIRED_CERTAINTY.consequential))
    add('refuse_trade', 0.6 + 0.3 * -affinity, { target: focus }, [near.id, ...neg.map((m) => m.id)],
      `won't trade with ${focus}: ${neg[0]!.summary}`);

  if (can('offer_quest') && affinity >= HOSTILE_AFFINITY) {
    const quest = [...facts.values()]
      .filter((f) => f.kind === 'quest' && f.subject === npcId && f.value === 'available')
      .sort((a, b) => a.id.localeCompare(b.id))[0];
    if (quest)
      add('offer_quest', 0.55 + 0.2 * Math.max(0, affinity), { target: focus, quest: quest.id.slice('quest:'.length) },
        [near.id, quest.id, ...pos.map((m) => m.id)], `offering ${quest.id.slice(6)} to ${focus}`);
  }

  if (can('call_guard')) {
    const crimes = neg.filter((m) => (m.kind === 'theft' || m.kind === 'attack') && tick - m.tick <= ALARM_WINDOW);
    const need = REQUIRED_CERTAINTY.irreversible;
    if (crimes.length && sureEnough(need))
      add('call_guard', 0.85, { target: focus }, [near.id, ...crimes.map((m) => m.id)], `${focus}: ${crimes[0]!.summary}`);
    else if (crimes.length && can('inquire'))
      add('inquire', 0.8, { target: focus }, [near.id, ...crimes.map((m) => m.id)],
        `not sure it was ${focus} (certainty ${certainty.toFixed(2)}, need more than ${need.toFixed(2)}); asking before raising the alarm`);
  }

  if (can('adjust_relationship') && relFact && mems.length) {
    const gap = relationshipTarget(memory, focus) - Number(relFact.value);
    if (Math.abs(gap) >= 3 && (gap > 0 || sureEnough(REQUIRED_CERTAINTY.consequential))) {
      const delta = clamp(gap, -role.maxRelationshipDelta, role.maxRelationshipDelta);
      add('adjust_relationship', 0.9, { target: focus, delta }, [relFact.id, ...mems.map((m) => m.id)],
        `memories justify relationship ${relationshipTarget(memory, focus)}, now ${relFact.value}`);
    }
  }

  return sortCandidates(out);
}

/** Moves a displaced NPC back to its post when nothing else is going on. */
function returnToPost(ctx: DecisionContext, pos: { x: number; z: number } | undefined): Candidate | null {
  if (!pos || !ctx.role.allowed.includes('move_to')) return null;
  const c = ctx.role.zone.center;
  if (Math.hypot(pos.x - c.x, pos.z - c.z) < 0.5) return null;
  return { proposal: { npcId: ctx.npcId, type: 'move_to', params: { x: c.x, z: c.z }, evidence: [], rationale: 'returning to my post', tier: 'utility' }, score: 0.2 };
}

export class TieredRuntime {
  private opts: Required<Omit<RuntimeOptions, 'model'>> & Pick<RuntimeOptions, 'model'>;

  constructor(opts: RuntimeOptions = {}) {
    this.opts = {
      model: opts.model,
      modelBudgetMs: opts.modelBudgetMs ?? 50,
      useModel: opts.useModel ?? (() => true),
      now: opts.now ?? (() => performance.now()),
    };
  }

  setModel(model: ModelDecider | undefined): void {
    this.opts.model = model;
  }

  /**
   * @param accept engine validation + verification; only accepted proposals are returned
   * @param selfPos current position, used for the return-to-post candidate
   */
  async decide(
    ctx: DecisionContext,
    accept: Acceptor,
    selfPos?: { x: number; z: number },
  ): Promise<Decision> {
    const t0 = this.opts.now();
    const rejected: Rejection[] = [];
    const ok = (p: ActionProposal, record: boolean) => {
      const r = accept(p);
      const pass = typeof r === 'boolean' ? r : r.ok;
      if (!pass && record) rejected.push({ proposal: p, issues: typeof r === 'boolean' ? [] : r.issues });
      return pass;
    };
    const ranked = utilityCandidates(ctx);
    const back = returnToPost(ctx, selfPos);
    if (back) ranked.splice(0, ranked.length, ...sortCandidates([...ranked, back]));
    const scores: CandidateScore[] = ranked.map((c) => ({ type: c.proposal.type, score: c.score, evidence: c.proposal.evidence }));
    const done = (proposal: ActionProposal, fallbackReason?: FallbackReason): Decision => ({
      proposal,
      candidates: scores,
      ...(rejected.length ? { rejected } : {}),
      ...(fallbackReason ? { fallbackReason } : {}),
      latencyMs: this.opts.now() - t0,
    });

    const r = reflex(ctx);
    if (r && ok(r, true)) {
      scores.unshift({ type: r.type, score: 1, evidence: r.evidence });
      return done(r);
    }

    let reason: FallbackReason | undefined;
    const { model } = this.opts;
    if (model && this.opts.useModel(ctx)) {
      const outcome = await this.callModel(model, ctx);
      if (outcome.kind === 'ok') {
        const p = { ...outcome.proposal, tier: 'model' as const };
        if (p.npcId !== ctx.npcId) rejected.push({ proposal: p, issues: [`npc_mismatch: proposal is for ${p.npcId}`] });
        else if (ok(p, true)) return done(p);
        reason = 'invalid';
      } else reason = outcome.kind;
    }

    for (const c of ranked) if (ok(c.proposal, false)) return done(c.proposal, reason);
    return done(idle(ctx.npcId, 'no candidate passed verification', 'fallback'), reason ?? 'invalid');
  }

  private async callModel(
    model: ModelDecider,
    ctx: DecisionContext,
  ): Promise<{ kind: 'ok'; proposal: ActionProposal } | { kind: 'timeout' | 'error' | 'empty' }> {
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>((res) => {
      timer = setTimeout(() => res('timeout'), this.opts.modelBudgetMs);
    });
    try {
      const r = await Promise.race([model.propose(ctx, ctrl.signal), timeout]);
      if (r === 'timeout') {
        ctrl.abort();
        return { kind: 'timeout' };
      }
      if (!r || typeof r !== 'object' || typeof r.type !== 'string') return { kind: 'empty' };
      return {
        kind: 'ok',
        proposal: {
          npcId: String(r.npcId),
          type: r.type,
          params: r.params && typeof r.params === 'object' ? r.params : {},
          evidence: Array.isArray(r.evidence) ? r.evidence.map(String) : [],
          rationale: typeof r.rationale === 'string' && r.rationale ? r.rationale : 'model proposal',
          tier: 'model',
        },
      };
    } catch {
      return { kind: 'error' };
    } finally {
      clearTimeout(timer);
    }
  }
}

function sortCandidates(cs: Candidate[]): Candidate[] {
  return cs.sort((a, b) => b.score - a.score || a.proposal.type.localeCompare(b.proposal.type));
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round3 = (v: number) => Math.round(v * 1000) / 1000;
