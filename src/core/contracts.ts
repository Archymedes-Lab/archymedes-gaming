// Commitments as contracts. Promises (player → NPC) and pledges (NPC → player) are obligations
// derived purely from the engine's event log: what was promised, what was delivered, by when.
// No model decides whether a promise was kept. Settlement writes the outcome back as engine
// events, and retracts it again if the deliveries it rested on are retracted.
import type { GameEvent } from './types';
import type { GameWorld } from './world';

export const PLEDGE_TTL = 60;
export const SETTLEMENT_TYPES = new Set<GameEvent['type']>(['promise_kept', 'promise_broken']);

export type ContractStatus = 'open' | 'kept' | 'broken';

export interface Contract {
  id: string; // the promise or pledge event id
  kind: 'promise' | 'pledge';
  debtor: string;
  creditor: string;
  tick: number;
  due: number;
  item?: string; // promise: what must be delivered
  qty?: number;
  discount?: number; // pledge: minimum discount owed on the next offer
  for?: string; // pledge: the settlement it rewards
  delivered: string[]; // events that fulfilled it
  status: ContractStatus;
}

export function deriveContracts(world: GameWorld): Contract[] {
  const out: Contract[] = [];
  const open = (c: Contract) => c.delivered.length === 0 || (c.kind === 'promise' && fulfilled(c) < (c.qty ?? 1));
  const fulfilled = (c: Contract) => c.delivered.length;
  for (const ev of world.events()) {
    if (ev.retracted) continue;
    const d = ev.data ?? {};
    if (ev.type === 'promise' && typeof d.item === 'string' && typeof d.due === 'number') {
      out.push({ id: ev.id, kind: 'promise', debtor: ev.actor, creditor: ev.target, tick: ev.tick, due: d.due,
        item: d.item, qty: Math.max(1, Number(d.qty ?? 1)), delivered: [], status: 'open' });
    } else if (ev.type === 'pledge' && typeof d.discount === 'number') {
      out.push({ id: ev.id, kind: 'pledge', debtor: ev.actor, creditor: ev.target, tick: ev.tick,
        due: typeof d.due === 'number' ? d.due : ev.tick + PLEDGE_TTL, discount: d.discount,
        ...(typeof d.for === 'string' ? { for: d.for } : {}), delivered: [], status: 'open' });
    } else if (ev.type === 'gift') {
      // each delivery fulfils one unit of the earliest open matching promise
      const c = out.find((c) => c.kind === 'promise' && c.debtor === ev.actor && c.creditor === ev.target &&
        c.item === d.item && ev.tick >= c.tick && ev.tick <= c.due && open(c));
      c?.delivered.push(ev.id);
    } else if (ev.type === 'offer') {
      const c = out.find((c) => c.kind === 'pledge' && c.debtor === ev.actor && c.creditor === ev.target &&
        Number(d.discount) >= (c.discount ?? 0) && ev.tick >= c.tick && ev.tick <= c.due && c.delivered.length === 0);
      c?.delivered.push(ev.id);
    }
  }
  for (const c of out) {
    const done = c.kind === 'promise' ? c.delivered.length >= (c.qty ?? 1) : c.delivered.length > 0;
    c.status = done ? 'kept' : world.tick > c.due ? 'broken' : 'open';
  }
  return out;
}

/** Brings settlement events in line with the derived contracts. Returns ids emitted or retracted. */
export function settle(world: GameWorld): string[] {
  const changed: string[] = [];
  const current = new Map<string, GameEvent>();
  for (const ev of world.events()) {
    if (!ev.retracted && SETTLEMENT_TYPES.has(ev.type)) current.set(String(ev.data?.contract), ev);
  }
  const promises = deriveContracts(world).filter((c) => c.kind === 'promise');
  const live = new Set(promises.map((c) => c.id));
  for (const [cid, ev] of current) {
    if (!live.has(cid)) {
      world.retract(ev.id);
      changed.push(ev.id);
    }
  }
  for (const c of promises) {
    const want = c.status === 'kept' ? 'promise_kept' : c.status === 'broken' ? 'promise_broken' : null;
    const have = current.get(c.id);
    if (have && have.type !== want) {
      world.retract(have.id);
      changed.push(have.id);
    }
    if (want && (!have || have.type !== want)) {
      const pos = world.getEntity(c.creditor)?.pos ?? { x: 0, z: 0 };
      changed.push(world.emit({ type: want, actor: c.debtor, target: c.creditor, pos: { ...pos }, data: { contract: c.id } }).id);
    }
  }
  return changed;
}
