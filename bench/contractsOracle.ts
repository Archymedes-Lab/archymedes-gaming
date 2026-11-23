// Independent re-derivation of promise and pledge status from the raw event log, written
// separately from src/core/contracts.ts so the benchmark does not grade the code with itself.
import type { GameEvent } from '../src/core/types';
import type { GameWorld } from '../src/core/world';

export interface OracleContract { status: 'open' | 'kept' | 'broken'; creditor: string; debtor: string; discount?: number }

export function oracleContracts(world: GameWorld): Map<string, OracleContract & { kind: string }> {
  const live = world.events().filter((e) => !e.retracted);
  const result = new Map<string, OracleContract & { kind: string }>();
  const usedGifts = new Set<string>();
  const usedOffers = new Set<string>();
  // process obligations in the order they were made; each claims the earliest unused qualifying delivery
  for (const p of live) {
    if (p.type === 'promise' && p.data && typeof p.data.item === 'string' && typeof p.data.due === 'number') {
      const need = Math.max(1, Number(p.data.qty ?? 1));
      const due = p.data.due;
      const claimed = pick(live, usedGifts, need, (g) =>
        g.type === 'gift' && g.actor === p.actor && g.target === p.target && g.data?.item === p.data!.item &&
        g.tick >= p.tick && g.tick <= due && Number(g.id.slice(3)) > Number(p.id.slice(3)));
      const status = claimed >= need ? 'kept' : world.tick > due ? 'broken' : 'open';
      result.set(p.id, { kind: 'promise', status, creditor: p.target, debtor: p.actor });
    }
    if (p.type === 'pledge' && typeof p.data?.discount === 'number') {
      const due = typeof p.data.due === 'number' ? p.data.due : p.tick + 60;
      const claimed = pick(live, usedOffers, 1, (o) =>
        o.type === 'offer' && o.actor === p.actor && o.target === p.target && Number(o.data?.discount) >= Number(p.data!.discount) &&
        o.tick >= p.tick && o.tick <= due && Number(o.id.slice(3)) > Number(p.id.slice(3)));
      const status = claimed >= 1 ? 'kept' : world.tick > due ? 'broken' : 'open';
      result.set(p.id, { kind: 'pledge', status, creditor: p.target, debtor: p.actor, discount: p.data.discount });
    }
  }
  return result;
}

function pick(events: GameEvent[], used: Set<string>, need: number, ok: (e: GameEvent) => boolean): number {
  let n = 0;
  for (const e of events) {
    if (n >= need) break;
    if (!used.has(e.id) && ok(e)) {
      used.add(e.id);
      n++;
    }
  }
  return n;
}

/** Highest discount the NPC currently owes `player` through open pledges. */
export function owedDiscount(world: GameWorld, npc: string, player: string): number {
  let owed = 0;
  for (const c of oracleContracts(world).values()) {
    if (c.kind === 'pledge' && c.status === 'open' && c.debtor === npc && c.creditor === player) owed = Math.max(owed, c.discount ?? 0);
  }
  return owed;
}
