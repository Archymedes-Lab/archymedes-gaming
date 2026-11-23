// Evidence-backed episodic memory. Every memory cites the game events it came from,
// decays by designer-set half-lives, and is corrected when the game stops backing it.
import type { EventType, GameEvent, Memory, MemoryPolicy, Vec2 } from './types';
import { SETTLEMENT_TYPES } from './contracts';
import { EVENT_TYPES } from './types';
import type { GameWorld } from './world';

export interface MemoryJSON {
  version: 1;
  npcId: string;
  nextId: number;
  memories: Memory[];
}

export interface RecallQuery {
  subject?: string;
  kind?: EventType;
  limit?: number;
}

export type InjectedMemory = Pick<Memory, 'kind' | 'subject' | 'tick' | 'summary' | 'evidence'> &
  Partial<Pick<Memory, 'baseSalience' | 'valence' | 'halfLife' | 'confidence'>>;

const VERBS: Record<EventType, string> = {
  rescue: 'rescued',
  theft: 'stole from',
  gift: 'gave a gift to',
  attack: 'attacked',
  promise: 'made a promise to',
  trade: 'traded with',
  greeting: 'greeted',
  alarm: 'raised the alarm about',
  inquiry: 'questioned',
  pledge: 'made a pledge to',
  offer: 'made an offer to',
  promise_kept: 'kept a promise to',
  promise_broken: 'broke a promise to',
};

const byRecall = (a: Memory, b: Memory) =>
  b.salience - a.salience || b.tick - a.tick || a.id.localeCompare(b.id);

export class MemoryStore {
  private memories = new Map<string, Memory>();
  private seenEvents = new Set<string>();
  private nextId = 1;

  constructor(
    readonly npcId: string,
    readonly policy: MemoryPolicy,
  ) {}

  /** Forms a memory from a game event if it is memorable and was experienced or witnessed. */
  observe(ev: GameEvent, npcPos: Vec2): Memory | null {
    if (ev.retracted || this.seenEvents.has(ev.id)) return null;
    const rule = this.policy.rules[ev.type];
    if (!rule || rule.salience < this.policy.forgetBelow || rule.salience <= 0) return null;

    const involved = ev.actor === this.npcId || ev.target === this.npcId;
    if (SETTLEMENT_TYPES.has(ev.type) && !involved) return null; // a contract's outcome is private to its parties
    const witnessed = Math.hypot(ev.pos.x - npcPos.x, ev.pos.z - npcPos.z) <= this.policy.perceptionRadius;
    if (!involved && !witnessed) return null;
    this.seenEvents.add(ev.id);

    // a witness remembers who it *thinks* did it, as the engine recorded its perception
    const seen = involved ? null : ev.witnesses?.[this.npcId];
    const doer = seen?.actor ?? ev.actor;
    const subject = ev.target === this.npcId ? ev.actor : ev.actor === this.npcId ? ev.target : doer;
    const confidence = involved ? 1 : (seen?.confidence ?? 1);
    const item = ev.data?.item ? ` (${ev.data.item})` : '';
    const unsure = confidence < 0.8 ? ', I think' : '';
    const mem = this.add({
      kind: ev.type,
      subject,
      tick: ev.tick,
      confidence,
      summary: `${doer} ${VERBS[ev.type]} ${ev.target === this.npcId ? 'me' : ev.target}${item}${unsure}`,
      evidence: [ev.id],
      baseSalience: rule.salience,
      valence: rule.valence,
      halfLife: rule.halfLife,
    });
    return this.memories.has(mem.id) ? mem : null;
  }

  /** Adds a memory from outside the perception pipeline (imports, tests, corruption drills). */
  inject(m: InjectedMemory): Memory {
    const rule = this.policy.rules[m.kind];
    return this.add({
      ...m,
      baseSalience: m.baseSalience ?? rule?.salience ?? 0.5,
      valence: m.valence ?? rule?.valence ?? 0,
      halfLife: m.halfLife ?? rule?.halfLife ?? 100,
      confidence: m.confidence ?? 1,
    });
  }

  /** Stores a memory, evicting the least valuable one if over capacity (possibly the new one). */
  private add(m: Omit<Memory, 'id' | 'npcId' | 'salience' | 'status'>): Memory {
    const mem: Memory = {
      ...m,
      evidence: [...m.evidence],
      id: `${this.npcId}:m${this.nextId++}`,
      npcId: this.npcId,
      baseSalience: clamp01(m.baseSalience),
      salience: clamp01(m.baseSalience),
      valence: Math.max(-1, Math.min(1, m.valence)) + 0, // + 0 normalises -0 so JSON round-trips exactly
      status: 'active',
    };
    this.memories.set(mem.id, mem);
    this.enforceCapacity();
    return mem;
  }

  private enforceCapacity(): void {
    while (this.memories.size > this.policy.capacity) {
      const victims = [...this.memories.values()].sort(
        (a, b) =>
          Number(b.status === 'corrected') - Number(a.status === 'corrected') ||
          a.salience - b.salience ||
          a.tick - b.tick ||
          a.id.localeCompare(b.id),
      );
      this.memories.delete(victims[0]!.id);
    }
  }

  get(id: string): Memory | undefined {
    return this.memories.get(id);
  }

  all(): Memory[] {
    return [...this.memories.values()];
  }

  /** Active memories only, most salient first. */
  recall(q: RecallQuery = {}): Memory[] {
    const out = this.all()
      .filter((m) => m.status === 'active')
      .filter((m) => q.subject === undefined || m.subject === q.subject)
      .filter((m) => q.kind === undefined || m.kind === q.kind)
      .sort(byRecall);
    return q.limit === undefined ? out : out.slice(0, q.limit);
  }

  correct(id: string, reason: string): boolean {
    const m = this.memories.get(id);
    if (!m || m.status === 'corrected') return false;
    m.status = 'corrected';
    m.correctionReason = reason;
    return true;
  }

  forget(id: string): boolean {
    return this.memories.delete(id);
  }

  /** Applies time decay; returns ids of active memories that faded below the forget threshold. */
  decayTo(tick: number): string[] {
    const forgotten: string[] = [];
    for (const m of this.all()) {
      const age = Math.max(0, tick - m.tick);
      m.salience = clamp01(m.baseSalience * Math.pow(0.5, age / Math.max(1, m.halfLife)));
      if (m.status === 'active' && m.salience < this.policy.forgetBelow) {
        this.memories.delete(m.id);
        forgotten.push(m.id);
      }
    }
    return forgotten;
  }

  /** Corrects active memories the authoritative game no longer backs. Returns corrected ids. */
  reconcile(world: GameWorld): string[] {
    const corrected: string[] = [];
    for (const m of this.recall()) {
      let reason: string | null = null;
      for (const id of m.evidence) {
        const ev = world.eventById(id);
        if (!ev) reason = `evidence-missing: ${id}`;
        else if (ev.retracted) reason = `evidence-retracted: ${id}`;
        else if (ev.type !== m.kind || !this.couldPerceive(ev, m.subject))
          reason = `evidence-mismatch: ${id} is ${ev.type} by ${ev.actor}`;
        if (reason) break;
      }
      if (m.evidence.length === 0) reason = 'evidence-missing: none cited';
      if (reason && this.correct(m.id, reason)) corrected.push(m.id);
    }
    return corrected;
  }

  /** Whether this NPC could honestly hold `subject` as the other party of `ev`, per engine perception. */
  private couldPerceive(ev: GameEvent, subject: string): boolean {
    if (ev.target === this.npcId) return subject === ev.actor;
    if (ev.actor === this.npcId) return subject === ev.target;
    const seen = ev.witnesses?.[this.npcId];
    if (seen) return subject === seen.actor;
    return subject === ev.actor || subject === ev.target; // legacy event without perception records
  }

  toJSON(): MemoryJSON {
    return {
      version: 1,
      npcId: this.npcId,
      nextId: this.nextId,
      memories: this.all().map((m) => structuredClone(m)),
    };
  }

  static fromJSON(data: unknown, policy: MemoryPolicy): MemoryStore {
    if (!data || typeof data !== 'object') throw new Error('memory: not an object');
    const j = data as Partial<MemoryJSON>;
    if (j.version !== 1 || typeof j.npcId !== 'string' || typeof j.nextId !== 'number' || !Array.isArray(j.memories))
      throw new Error('memory: bad schema');
    const store = new MemoryStore(j.npcId, policy);
    store.nextId = j.nextId;
    for (const raw of j.memories) {
      if (!isMemory(raw)) throw new Error('memory: bad record');
      const m = structuredClone(raw);
      m.confidence ??= 1; // saves from before perception records
      store.memories.set(m.id, m);
      m.evidence.forEach((e) => store.seenEvents.add(e));
    }
    store.enforceCapacity();
    return store;
  }
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

function isMemory(m: unknown): m is Memory {
  if (!m || typeof m !== 'object') return false;
  const r = m as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.subject === 'string' &&
    typeof r.salience === 'number' &&
    EVENT_TYPES.includes(r.kind as EventType) &&
    Array.isArray(r.evidence) &&
    (r.status === 'active' || r.status === 'corrected')
  );
}
