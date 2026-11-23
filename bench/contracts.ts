// Pre-registered prototype test for commitments as contracts (docs/NEXT-INNOVATION.md, C1–C3).
import type { ModelDecider } from '../src/core/decide';
import { ReliabilityLayer } from '../src/core/layer';
import { InMemoryStorage } from '../src/core/persistence';
import { act, MERCHANT, PLAYER, villageConfig } from '../src/game/village';
import { oracleContracts, owedDiscount } from './contractsOracle';
import { rng } from './noisyModel';

export interface ContractsResult {
  checks: number; // settlement-vs-oracle comparisons
  mismatches: number;
  offers: number;
  undercuts: number; // executed offers below an open pledge (oracle view, at decision time)
  keeperDiscounts: number[];
  breakerDiscounts: number[];
  pledges: number;
}

export async function runContracts(sessions = 200, steps = 80, model?: (seed: number) => ModelDecider): Promise<ContractsResult> {
  const res: ContractsResult = { checks: 0, mismatches: 0, offers: 0, undercuts: 0, keeperDiscounts: [], breakerDiscounts: [], pledges: 0 };
  for (let s = 1; s <= sessions; s++) {
    const r = rng(s * 31 + 3);
    const keeper = s % 2 === 0; // half the sessions the player keeps promises, half breaks them
    const storage = new InMemoryStorage();
    const cfg = {
      ...villageConfig({ features: { contracts: true }, ...(model ? { model: model(s) } : {}) }),
      monitor: (p: { type: string; npcId: string; params: Record<string, string | number> }, world: import('../src/core/world').GameWorld) => {
        if (p.type !== 'offer_trade') return;
        res.offers++;
        if (Number(p.params.discount) < owedDiscount(world, p.npcId, String(p.params.target))) res.undercuts++;
        (keeper ? res.keeperDiscounts : res.breakerDiscounts).push(Number(p.params.discount));
      },
    };
    let { layer } = ReliabilityLayer.create(cfg, storage);
    layer.world.setItem(PLAYER, 'bread', 50);
    for (let i = 0; i < steps; i++) {
      const w = layer.world;
      const x = r();
      if (x < 0.12) act.promise(w, MERCHANT, { item: 'bread', qty: 1 + Math.floor(r() * 2), due: w.tick + 3 + Math.floor(r() * 12) });
      else if (x < 0.27 && keeper) act.gift(w, MERCHANT, 'bread');
      else if (x < 0.31) {
        const gifts = w.events().filter((e) => e.type === 'gift' && !e.retracted);
        if (gifts.length) w.retract(gifts[Math.floor(r() * gifts.length)]!.id);
      } else if (x < 0.34) {
        layer.save();
        layer = ReliabilityLayer.create(cfg, storage).layer;
      } else {
        for (const t of await layer.tick()) if (t.executed.type === 'pledge') res.pledges++;
        // C1: after settlement, the engine's outcome events match the independent re-derivation
        const live = new Map<string, string>();
        for (const e of layer.world.events()) if (!e.retracted && (e.type === 'promise_kept' || e.type === 'promise_broken')) live.set(String(e.data?.contract), e.type);
        for (const [id, c] of oracleContracts(layer.world)) {
          if (c.kind !== 'promise') continue;
          // settlement runs at the start of a tick, so judge against the status as of that tick
          res.checks++;
          const want = c.status === 'kept' ? 'promise_kept' : c.status === 'broken' ? 'promise_broken' : undefined;
          if (live.get(id) !== want) res.mismatches++;
        }
      }
    }
  }
  return res;
}
