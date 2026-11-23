// Sample project: a small market village with a merchant, a guard and an elder.
// This file plays the role of the studio's game code and designer configuration.
import type { LayerConfig } from '../core/layer';
import type { NpcConfig } from '../core/npc';
import type { GameEvent, MemoryPolicy, Vec2 } from '../core/types';
import { GameWorld } from '../core/world';

export const PLAYER = 'player';
export const MERCHANT = 'mira';
export const GUARD = 'bram';
export const ELDER = 'elda';
export const QUEST_CARAVAN = 'q-caravan';

export const POSTS: Record<string, Vec2> = {
  [MERCHANT]: { x: 0, z: 0 },
  [GUARD]: { x: 12, z: 0 },
  [ELDER]: { x: -10, z: 6 },
};
export const PLAYER_START: Vec2 = { x: 0, z: 6 };

export function seedVillage(): GameWorld {
  const w = new GameWorld();
  w.defineItem({ id: 'potion', name: 'Healing Potion', basePrice: 12 });
  w.defineItem({ id: 'bread', name: 'Bread', basePrice: 2 });
  w.defineItem({ id: 'sword', name: 'Iron Sword', basePrice: 60 });
  w.defineItem({ id: 'ration', name: 'Guard Ration', basePrice: 3 });

  w.addEntity({ id: PLAYER, kind: 'player', name: 'Ash', pos: PLAYER_START, faction: 'travellers' });
  w.addEntity({ id: MERCHANT, kind: 'npc', name: 'Mira', pos: POSTS[MERCHANT]!, faction: 'village' });
  w.addEntity({ id: GUARD, kind: 'npc', name: 'Bram', pos: POSTS[GUARD]!, faction: 'watch' });
  w.addEntity({ id: ELDER, kind: 'npc', name: 'Elda', pos: POSTS[ELDER]!, faction: 'village' });

  w.setItem(MERCHANT, 'bread', 10);
  w.setItem(MERCHANT, 'potion', 5);
  w.setItem(MERCHANT, 'sword', 1);
  w.setItem(GUARD, 'ration', 3);
  w.setItem(PLAYER, 'bread', 2);
  w.setGold(PLAYER, 100);
  w.setGold(MERCHANT, 250);
  w.addQuest({ id: QUEST_CARAVAN, title: 'The Lost Caravan', giver: ELDER, status: 'available' });
  return w;
}

const social = {
  greeting: { salience: 0.15, valence: 0.1, halfLife: 15 },
  gift: { salience: 0.6, valence: 0.6, halfLife: 400 },
  promise: { salience: 0.5, valence: 0.3, halfLife: 300 },
};

const merchantMemory: MemoryPolicy = {
  capacity: 12,
  forgetBelow: 0.05,
  perceptionRadius: 8,
  rules: {
    ...social,
    rescue: { salience: 0.9, valence: 1, halfLife: 2000 },
    theft: { salience: 0.85, valence: -1, halfLife: 1500 },
    attack: { salience: 1, valence: -1, halfLife: 1500 },
    promise_kept: { salience: 0.8, valence: 0.8, halfLife: 1500 },
    promise_broken: { salience: 0.75, valence: -0.7, halfLife: 1000 },
  },
};

export const NPCS: NpcConfig[] = [
  {
    id: MERCHANT,
    role: {
      role: 'merchant',
      allowed: ['idle', 'greet', 'offer_trade', 'refuse_trade', 'flee', 'move_to', 'adjust_relationship', 'pledge'],
      zone: { center: POSTS[MERCHANT]!, radius: 4 },
      maxDiscount: 30,
      maxRelationshipDelta: 10,
      cooldowns: { adjust_relationship: 3, greet: 6 },
    },
    memory: merchantMemory,
    knowledge: { categories: ['inventory', 'prices', 'relationships', 'nearby', 'gold', 'commitments'], perceptionRadius: 8 },
  },
  {
    id: GUARD,
    role: {
      role: 'guard',
      allowed: ['idle', 'greet', 'call_guard', 'inquire', 'move_to', 'adjust_relationship'],
      zone: { center: POSTS[GUARD]!, radius: 6 },
      maxDiscount: 0,
      maxRelationshipDelta: 10,
      cooldowns: { adjust_relationship: 3, call_guard: 4, greet: 6 },
    },
    memory: {
      capacity: 10,
      forgetBelow: 0.05,
      perceptionRadius: 8,
      rules: {
        ...social,
        gift: { salience: 0.4, valence: 0.5, halfLife: 200 },
        rescue: { salience: 0.5, valence: 1, halfLife: 1000 },
        theft: { salience: 0.9, valence: -1, halfLife: 800 },
        attack: { salience: 1, valence: -1, halfLife: 800 },
      },
    },
    knowledge: { categories: ['nearby', 'relationships'], perceptionRadius: 8 },
  },
  {
    id: ELDER,
    role: {
      role: 'elder',
      allowed: ['idle', 'greet', 'offer_quest', 'move_to', 'adjust_relationship'],
      zone: { center: POSTS[ELDER]!, radius: 3 },
      maxDiscount: 0,
      maxRelationshipDelta: 10,
      cooldowns: { adjust_relationship: 3, offer_quest: 5, greet: 6 },
    },
    memory: {
      capacity: 10,
      forgetBelow: 0.05,
      perceptionRadius: 6,
      rules: {
        ...social,
        promise: { salience: 0.7, valence: 0.5, halfLife: 1000 },
        rescue: { salience: 0.9, valence: 1, halfLife: 3000 },
        theft: { salience: 0.8, valence: -1, halfLife: 1000 },
        attack: { salience: 1, valence: -1, halfLife: 1000 },
      },
    },
    knowledge: { categories: ['quests', 'prices', 'nearby', 'relationships'], perceptionRadius: 6 },
  },
];

export type VillageOptions = Pick<LayerConfig, 'model' | 'modelBudgetMs' | 'useModel' | 'features'>;

export function villageConfig(opts: VillageOptions = {}): LayerConfig {
  return { seedWorld: seedVillage, npcs: NPCS, ...opts };
}

// ---- player verbs: game logic, authoritative, emits the events NPCs perceive ----

const here = (w: GameWorld): Vec2 => ({ ...(w.getEntity(PLAYER)?.pos ?? PLAYER_START) });
const plain = (type: GameEvent['type']) => (w: GameWorld, npc: string) =>
  w.emit({ type, actor: PLAYER, target: npc, pos: here(w) });

export const act = {
  rescue: plain('rescue'),
  attack: plain('attack'),
  greet: plain('greeting'),
  /** A promise with engine-checkable terms: deliver `qty` of `item` by tick `due`. */
  promise(w: GameWorld, npc: string, terms: { item?: string; qty?: number; due?: number } = {}): GameEvent {
    const data = { item: terms.item ?? 'bread', qty: terms.qty ?? 1, due: terms.due ?? w.tick + 30 };
    return w.emit({ type: 'promise', actor: PLAYER, target: npc, pos: here(w), data });
  },
  steal(w: GameWorld, npc: string, item: string): GameEvent | null {
    if (!w.transfer(npc, PLAYER, item)) return null;
    return w.emit({ type: 'theft', actor: PLAYER, target: npc, pos: here(w), data: { item } });
  },
  gift(w: GameWorld, npc: string, item: string): GameEvent | null {
    if (!w.transfer(PLAYER, npc, item)) return null;
    return w.emit({ type: 'gift', actor: PLAYER, target: npc, pos: here(w), data: { item } });
  },
  moveTo(w: GameWorld, pos: Vec2): void {
    w.moveEntity(PLAYER, pos);
  },
};
