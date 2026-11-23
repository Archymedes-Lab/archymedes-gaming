// Authoritative game state. Stands in for the studio's engine: the reliability layer
// reads from it and proposes actions, but only the engine mutates it.
import type { Entity, GameEvent, ItemDef, Perception, Quest, QuestStatus, Vec2 } from './types';

/** Beyond this distance an NPC perceives nothing of an event it is not part of. */
export const WITNESS_RANGE = 12;
/** Other people this close to the culprit make a witness unsure who it was. */
export const AMBIGUITY_RADIUS = 2.5;

export interface WorldJSON {
  tick: number;
  nextEvent: number;
  items: ItemDef[];
  entities: Entity[];
  inventory: Record<string, Record<string, number>>;
  gold: Record<string, number>;
  quests: Quest[];
  relationships: Record<string, number>;
  events: GameEvent[];
}

const relKey = (a: string, b: string) => `${a}|${b}`;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export class GameWorld {
  tick = 0;
  private nextEvent = 0;
  private items = new Map<string, ItemDef>();
  private ents = new Map<string, Entity>();
  private inv = new Map<string, Map<string, number>>();
  private goldBy = new Map<string, number>();
  private questsById = new Map<string, Quest>();
  private rels = new Map<string, number>();
  private log: GameEvent[] = [];
  private byId = new Map<string, GameEvent>();

  advance(): number {
    return ++this.tick;
  }

  // ---- items & inventory ----
  defineItem(def: ItemDef): void {
    this.items.set(def.id, { ...def });
  }
  itemDef(id: string): ItemDef | undefined {
    return this.items.get(id);
  }
  itemDefs(): ItemDef[] {
    return [...this.items.values()];
  }
  setItem(owner: string, item: string, qty: number): void {
    if (!this.items.has(item)) throw new Error(`unknown item ${item}`);
    if (!Number.isInteger(qty) || qty < 0) throw new Error(`invalid quantity ${qty}`);
    let bag = this.inv.get(owner);
    if (!bag) this.inv.set(owner, (bag = new Map()));
    if (qty === 0) bag.delete(item);
    else bag.set(item, qty);
  }
  itemQty(owner: string, item: string): number {
    return this.inv.get(owner)?.get(item) ?? 0;
  }
  inventory(owner: string): Record<string, number> {
    return Object.fromEntries([...(this.inv.get(owner) ?? [])].sort(([a], [b]) => a.localeCompare(b)));
  }
  /** Moves one unit; returns false when the source does not hold it. */
  transfer(from: string, to: string, item: string): boolean {
    const have = this.itemQty(from, item);
    if (have < 1 || !this.items.has(item)) return false;
    this.setItem(from, item, have - 1);
    this.setItem(to, item, this.itemQty(to, item) + 1);
    return true;
  }

  gold(id: string): number {
    return this.goldBy.get(id) ?? 0;
  }
  setGold(id: string, amount: number): void {
    this.goldBy.set(id, Math.max(0, Math.floor(amount)));
  }

  // ---- entities ----
  addEntity(e: Entity): void {
    this.ents.set(e.id, { ...e, pos: { ...e.pos } });
  }
  getEntity(id: string): Entity | undefined {
    return this.ents.get(id);
  }
  entities(): Entity[] {
    return [...this.ents.values()];
  }
  moveEntity(id: string, pos: Vec2): void {
    const e = this.ents.get(id);
    if (e) e.pos = { x: pos.x, z: pos.z };
  }

  // ---- quests ----
  addQuest(q: Quest): void {
    this.questsById.set(q.id, { ...q });
  }
  quest(id: string): Quest | undefined {
    return this.questsById.get(id);
  }
  quests(): Quest[] {
    return [...this.questsById.values()];
  }
  setQuestStatus(id: string, status: QuestStatus): void {
    const q = this.questsById.get(id);
    if (q) q.status = status;
  }
  questsJSON(): Quest[] {
    return this.quests().map((q) => ({ ...q }));
  }

  // ---- relationships ----
  relationship(npc: string, other: string): number {
    return this.rels.get(relKey(npc, other)) ?? 0;
  }
  adjustRelationship(npc: string, other: string, delta: number): number {
    const v = clamp(this.relationship(npc, other) + delta, -100, 100);
    this.rels.set(relKey(npc, other), v);
    return v;
  }

  // ---- events ----
  emit(e: Omit<GameEvent, 'id' | 'tick' | 'witnesses'>): GameEvent {
    const ev: GameEvent = { ...e, pos: { ...e.pos }, id: `ev-${this.nextEvent++}`, tick: this.tick };
    const witnesses = this.perceive(ev);
    if (Object.keys(witnesses).length) ev.witnesses = witnesses;
    this.log.push(ev);
    this.byId.set(ev.id, ev);
    return ev;
  }
  /**
   * The engine's record of what each NPC perceived. Those involved know who it was. Others are
   * less sure with distance, and when other people stand next to the culprit, a witness picks
   * whoever was nearest to it, possibly the wrong person.
   */
  private perceive(ev: GameEvent): Record<string, Perception> {
    const out: Record<string, Perception> = {};
    const others = this.entities().filter(
      (e) => e.kind === 'player' && e.id !== ev.actor && Math.hypot(e.pos.x - ev.pos.x, e.pos.z - ev.pos.z) <= AMBIGUITY_RADIUS,
    );
    for (const npc of this.entities()) {
      if (npc.kind !== 'npc') continue;
      if (npc.id === ev.actor || npc.id === ev.target) {
        out[npc.id] = { actor: ev.actor, confidence: 1 };
        continue;
      }
      const d = Math.hypot(npc.pos.x - ev.pos.x, npc.pos.z - ev.pos.z);
      if (d > WITNESS_RANGE) continue;
      let confidence = 0.4 + 0.6 * (1 - d / WITNESS_RANGE);
      let actor = ev.actor;
      const actorPos = this.getEntity(ev.actor)?.pos ?? ev.pos;
      if (others.length) {
        const dist = (p: Vec2) => Math.hypot(p.x - npc.pos.x, p.z - npc.pos.z);
        const suspects = [{ id: ev.actor, d: dist(actorPos) }, ...others.map((o) => ({ id: o.id, d: dist(o.pos) }))];
        suspects.sort((a, b) => a.d - b.d || a.id.localeCompare(b.id));
        actor = suspects[0]!.id;
        confidence = Math.min(confidence, 1 / suspects.length);
      }
      out[npc.id] = { actor, confidence: Math.round(confidence * 1000) / 1000 };
    }
    return out;
  }

  events(): readonly GameEvent[] {
    return this.log;
  }
  eventById(id: string): GameEvent | undefined {
    return this.byId.get(id);
  }
  retract(id: string): void {
    const ev = this.byId.get(id);
    if (ev) ev.retracted = true;
  }
  isValidEvidence(id: string): boolean {
    const ev = this.byId.get(id);
    return !!ev && !ev.retracted;
  }

  // ---- persistence ----
  toJSON(): WorldJSON {
    const inventory: Record<string, Record<string, number>> = {};
    for (const owner of [...this.inv.keys()].sort()) inventory[owner] = this.inventory(owner);
    return {
      tick: this.tick,
      nextEvent: this.nextEvent,
      items: this.itemDefs().map((i) => ({ ...i })),
      entities: this.entities().map((e) => ({ ...e, pos: { ...e.pos } })),
      inventory,
      gold: Object.fromEntries([...this.goldBy].sort(([a], [b]) => a.localeCompare(b))),
      quests: this.questsJSON(),
      relationships: Object.fromEntries([...this.rels].sort(([a], [b]) => a.localeCompare(b))),
      events: this.log.map((e) => structuredClone(e)),
    };
  }

  static fromJSON(j: WorldJSON): GameWorld {
    const w = new GameWorld();
    w.tick = j.tick;
    w.nextEvent = j.nextEvent;
    j.items.forEach((i) => w.defineItem(i));
    j.entities.forEach((e) => w.addEntity(e));
    for (const [owner, bag] of Object.entries(j.inventory)) {
      for (const [item, qty] of Object.entries(bag)) w.setItem(owner, item, qty);
    }
    for (const [id, g] of Object.entries(j.gold)) w.goldBy.set(id, g);
    j.quests.forEach((q) => w.addQuest(q));
    for (const [k, v] of Object.entries(j.relationships)) w.rels.set(k, v);
    for (const e of j.events) {
      const ev = structuredClone(e);
      w.log.push(ev);
      w.byId.set(ev.id, ev);
    }
    return w;
  }
}
