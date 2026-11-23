// Contract types for the NPC Reliability Layer.
// The game engine (GameWorld) is authoritative; the layer only reads facts and proposes actions.

export interface Vec2 {
  x: number;
  z: number;
}

export type EntityKind = 'player' | 'npc';

export interface Entity {
  id: string;
  kind: EntityKind;
  name: string;
  pos: Vec2;
  faction: string;
}

export type EventType =
  | 'rescue'
  | 'theft'
  | 'gift'
  | 'attack'
  | 'promise'
  | 'trade'
  | 'greeting'
  | 'alarm'
  | 'inquiry'
  | 'pledge' // an NPC's commitment to a player
  | 'offer' // an NPC's trade offer (settles pledges)
  | 'promise_kept' // settlement, emitted by contract settlement from the event log
  | 'promise_broken';

export const EVENT_TYPES: readonly EventType[] = [
  'rescue',
  'theft',
  'gift',
  'attack',
  'promise',
  'trade',
  'greeting',
  'alarm',
  'inquiry',
  'pledge',
  'offer',
  'promise_kept',
  'promise_broken',
];

/** What one NPC perceived of an event: who it thinks did it and how sure it is. Computed by the engine. */
export interface Perception {
  actor: string;
  confidence: number; // 0..1
}

export interface GameEvent {
  id: string;
  tick: number;
  type: EventType;
  actor: string;
  target: string;
  pos: Vec2;
  data?: Record<string, string | number>;
  retracted?: boolean;
  witnesses?: Record<string, Perception>;
}

export type QuestStatus = 'available' | 'active' | 'completed';

export interface Quest {
  id: string;
  title: string;
  giver: string;
  status: QuestStatus;
}

export interface ItemDef {
  id: string;
  name: string;
  basePrice: number;
}

// ---------- memory ----------

export interface MemoryRule {
  salience: number; // 0..1 at formation
  valence: number; // -1..1 how the NPC feels about the subject
  halfLife: number; // ticks
}

export interface MemoryPolicy {
  capacity: number;
  forgetBelow: number; // active memories decaying under this are forgotten
  perceptionRadius: number; // witnessed events must be this close
  rules: Partial<Record<EventType, MemoryRule>>;
}

export type MemoryStatus = 'active' | 'corrected';

export interface Memory {
  id: string;
  npcId: string;
  kind: EventType;
  subject: string;
  tick: number;
  summary: string;
  baseSalience: number;
  salience: number;
  valence: number;
  halfLife: number;
  confidence: number; // how sure the NPC is about who it was (engine perception)
  evidence: string[]; // game event ids
  status: MemoryStatus;
  correctionReason?: string;
}

// ---------- grounding ----------

export type KnowledgeCategory = 'inventory' | 'prices' | 'quests' | 'relationships' | 'nearby' | 'gold' | 'commitments';

export interface KnowledgePolicy {
  categories: KnowledgeCategory[];
  perceptionRadius: number;
}

export type FactKind = 'inventory' | 'price' | 'quest' | 'relationship' | 'nearby' | 'gold' | 'pledge' | 'commitment';

export interface Fact {
  id: string;
  kind: FactKind;
  subject: string;
  value: string | number;
}

export type FactSet = ReadonlyMap<string, Fact>;

// ---------- actions (hard boundary) ----------

export type ActionType =
  | 'idle'
  | 'greet'
  | 'offer_trade'
  | 'refuse_trade'
  | 'offer_quest'
  | 'flee'
  | 'call_guard'
  | 'move_to'
  | 'adjust_relationship'
  | 'inquire'
  | 'pledge';

export const ACTION_TYPES: readonly ActionType[] = [
  'idle',
  'greet',
  'offer_trade',
  'refuse_trade',
  'offer_quest',
  'flee',
  'call_guard',
  'move_to',
  'adjust_relationship',
  'inquire',
  'pledge',
];

/** Actions that need no evidence to be grounded. */
export const EVIDENCE_EXEMPT: readonly ActionType[] = ['idle', 'move_to']; // movement is bounded by zone, not by evidence

export type Tier = 'reflex' | 'utility' | 'model' | 'fallback';

export interface ActionProposal {
  npcId: string;
  type: string; // string, not ActionType: proposals from models are untrusted
  params: Record<string, string | number>;
  evidence: string[]; // fact ids or memory ids
  rationale: string;
  tier: Tier;
}

export interface Zone {
  center: Vec2;
  radius: number;
}

export interface RoleSpec {
  role: string;
  allowed: ActionType[];
  zone: Zone;
  maxDiscount: number; // percent
  maxRelationshipDelta: number;
  cooldowns?: Partial<Record<ActionType, number>>;
}

export type ViolationCode =
  | 'unknown_action'
  | 'not_permitted'
  | 'unknown_item'
  | 'not_in_inventory'
  | 'unknown_quest'
  | 'quest_unavailable'
  | 'not_quest_giver'
  | 'out_of_bounds'
  | 'param_out_of_range'
  | 'unknown_target'
  | 'cooldown'
  | 'bad_params';

export interface Violation {
  code: ViolationCode;
  detail: string;
}

export interface Validation {
  ok: boolean;
  violations: Violation[];
}

export interface ExecutionResult extends Validation {
  effects: string[];
}

// ---------- verification & observability ----------

export interface Verdict {
  grounded: boolean;
  permitted: boolean;
  consistent: boolean;
  proportionate: boolean; // evidence certainty matches how irreversible the action is
  ok: boolean;
  issues: string[];
}

export interface CandidateScore {
  type: string;
  score: number;
  evidence: string[];
}

export interface Rejection {
  proposal: ActionProposal;
  issues: string[];
}

export type FallbackReason = 'timeout' | 'error' | 'invalid' | 'ungrounded' | 'empty';

export interface Trace {
  tick: number;
  npcId: string;
  focus: string | null;
  newMemories: string[];
  corrected: string[];
  forgotten: string[];
  recalled: Memory[];
  candidates: CandidateScore[];
  proposal: ActionProposal; // what was decided by the runtime
  rejected?: Rejection[]; // proposals from higher tiers that failed verification
  executed: ActionProposal; // what actually ran (proposal, or idle fallback)
  verdict: Verdict;
  violations: Violation[];
  effects: string[];
  fallbackReason?: FallbackReason;
  latencyMs: number;
}

// ---------- Q&A ----------

export type Question =
  | { type: 'has_item'; item: string }
  | { type: 'price'; item: string }
  | { type: 'quest_status'; quest: string }
  | { type: 'remember'; subject: string };

export interface Answer {
  known: boolean;
  text: string;
  citations: string[];
}
