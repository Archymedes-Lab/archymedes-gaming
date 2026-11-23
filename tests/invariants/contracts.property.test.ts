// C2 under fuzzing: whatever players promise, deliver or have retracted, and whatever a fully
// adversarial model proposes, no executed offer undercuts an open pledge, no pledge is made
// without something to reward, and settlement always matches the independent re-derivation.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ReliabilityLayer } from '../../src/core/layer';
import { InMemoryStorage } from '../../src/core/persistence';
import type { ActionProposal } from '../../src/core/types';
import type { GameWorld } from '../../src/core/world';
import { act, MERCHANT, PLAYER, villageConfig } from '../../src/game/village';
import { oracleContracts, owedDiscount } from '../../bench/contractsOracle';

const cmd = fc.oneof(
  { weight: 5, arbitrary: fc.constant({ k: 'tick' as const }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant('promise' as const), qty: fc.integer({ min: 1, max: 3 }), due: fc.integer({ min: 0, max: 15 }) }) },
  { weight: 2, arbitrary: fc.constant({ k: 'gift' as const }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('retract' as const), n: fc.nat() }) },
  { weight: 1, arbitrary: fc.constant({ k: 'reload' as const }) },
);
const proposal = fc.record({
  type: fc.constantFrom('offer_trade', 'pledge'),
  discount: fc.integer({ min: -5, max: 40 }),
  item: fc.constantFrom('potion', 'bread'),
  cite: fc.boolean(),
});

describe('contracts invariants', () => {
  it('no undercut pledge, no groundless pledge, settlement always re-derivable', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(cmd, { maxLength: 50 }), fc.array(proposal, { minLength: 1, maxLength: 8 }), async (cmds, props) => {
        let i = 0;
        const model = {
          propose: async (ctx: { npcId: string; facts: ReadonlyMap<string, { kind: string }> }): Promise<ActionProposal> => {
            const p = props[i++ % props.length]!;
            const pledgeFacts = [...ctx.facts.keys()].filter((k) => k.startsWith('pledge:'));
            return {
              npcId: ctx.npcId, type: p.type, rationale: 'adversary', tier: 'model',
              params: p.type === 'pledge' ? { target: PLAYER, discount: p.discount } : { target: PLAYER, item: p.item, discount: p.discount },
              evidence: [`near:${PLAYER}`, `inv:${ctx.npcId}:${p.item}`, ...(p.cite ? pledgeFacts : [])],
            };
          },
        };
        const bad: string[] = [];
        const cfg = {
          ...villageConfig({ model, features: { contracts: true } }),
          monitor: (p: ActionProposal, world: GameWorld, memory: { recall: (q: { subject: string }) => { valence: number }[] }) => {
            if (p.type === 'offer_trade' && Number(p.params.discount) < owedDiscount(world, p.npcId, String(p.params.target)))
              bad.push(`undercut ${JSON.stringify(p.params)}`);
            if (p.type === 'pledge' && !memory.recall({ subject: String(p.params.target) }).some((m) => m.valence > 0))
              bad.push('groundless pledge');
          },
        };
        const storage = new InMemoryStorage();
        let { layer } = ReliabilityLayer.create(cfg, storage);
        layer.world.setItem(PLAYER, 'bread', 30);
        for (const c of cmds) {
          const w = layer.world;
          if (c.k === 'promise') act.promise(w, MERCHANT, { item: 'bread', qty: c.qty, due: w.tick + c.due });
          else if (c.k === 'gift') act.gift(w, MERCHANT, 'bread');
          else if (c.k === 'retract') {
            const gifts = w.events().filter((e) => e.type === 'gift');
            if (gifts.length) w.retract(gifts[c.n % gifts.length]!.id);
          } else if (c.k === 'reload') {
            layer.save();
            layer = ReliabilityLayer.create(cfg, storage).layer;
          } else {
            await layer.tick();
            const live = new Map<string, string>();
            for (const e of layer.world.events())
              if (!e.retracted && (e.type === 'promise_kept' || e.type === 'promise_broken')) live.set(String(e.data?.contract), e.type);
            for (const [id, o] of oracleContracts(layer.world)) {
              if (o.kind !== 'promise') continue;
              const want = o.status === 'kept' ? 'promise_kept' : o.status === 'broken' ? 'promise_broken' : undefined;
              expect(live.get(id)).toBe(want);
            }
          }
        }
        expect(bad).toEqual([]);
      }),
      { numRuns: 80 },
    );
  });
});
