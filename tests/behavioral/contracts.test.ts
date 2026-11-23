// Commitments as contracts, end to end in the village (feature on explicitly until adopted).
import { describe, expect, it } from 'vitest';
import { InMemoryStorage } from '../../src/core/persistence';
import { act, MERCHANT, PLAYER } from '../../src/game/village';
import { newSession, of, run } from './helpers';

const contracts = { features: { contracts: true } };

describe('Commitments as contracts', () => {
  it('a kept promise earns a pledge that the merchant honours, even after a save and reload', async () => {
    const storage = new InMemoryStorage();
    const s1 = newSession(storage, contracts);
    const w = s1.layer.world;
    act.promise(w, MERCHANT, { item: 'bread', qty: 1, due: w.tick + 20 });
    act.gift(w, MERCHANT, 'bread');
    // save the moment the pledge is made, so it is still open when the next session starts
    let pledge;
    for (let i = 0; i < 6 && !pledge; i++) pledge = of(await s1.layer.tick(), MERCHANT).find((t) => t.executed.type === 'pledge');
    expect(pledge).toBeDefined();
    expect(pledge!.executed.rationale).toMatch(/kept their word/);
    s1.layer.save();

    const s2 = newSession(storage, contracts);
    const offer = of(await run(s2.layer, 6), MERCHANT).find((t) => t.executed.type === 'offer_trade')!;
    expect(Number(offer.executed.params.discount)).toBeGreaterThanOrEqual(Number(pledge!.executed.params.discount));
    expect(offer.executed.evidence.some((e) => e.startsWith('pledge:'))).toBe(true);
  });

  it('if the delivery is retracted, the gratitude is corrected', async () => {
    const { layer } = newSession(new InMemoryStorage(), contracts);
    const w = layer.world;
    act.promise(w, MERCHANT, { item: 'bread', qty: 1, due: w.tick + 20 });
    const g = act.gift(w, MERCHANT, 'bread')!;
    await run(layer, 2);
    const kept = layer.memory(MERCHANT).recall({ kind: 'promise_kept' });
    expect(kept).toHaveLength(1);
    w.retract(g.id);
    const t = of(await run(layer, 1), MERCHANT)[0]!;
    expect(t.corrected).toContain(kept[0]!.id);
    expect(layer.memory(MERCHANT).recall({ kind: 'promise_kept' })).toHaveLength(0);
  });

  it('a broken promise is remembered and costs the player their goodwill', async () => {
    const { layer } = newSession(new InMemoryStorage(), contracts);
    const w = layer.world;
    act.promise(w, MERCHANT, { item: 'potion', qty: 1, due: w.tick + 3 });
    const traces = of(await run(layer, 8), MERCHANT);
    expect(layer.memory(MERCHANT).recall({ subject: PLAYER, kind: 'promise_broken' })).toHaveLength(1);
    expect(traces.every((t) => t.executed.type !== 'pledge')).toBe(true);
    expect(w.relationship(MERCHANT, PLAYER)).toBeLessThan(0);
  });
});
