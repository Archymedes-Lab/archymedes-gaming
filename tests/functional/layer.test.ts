import { describe, expect, it } from 'vitest';
import { ReliabilityLayer } from '../../src/core/layer';
import { act, MERCHANT, NPCS, villageConfig } from '../../src/game/village';
import type { ActionProposal, Vec2 } from '../../src/core/types';

describe('ReliabilityLayer monitor hook (external auditors)', () => {
  it('sees every executed action before its effects are applied', async () => {
    const seen: { p: ActionProposal; pos: Vec2 }[] = [];
    const { layer } = ReliabilityLayer.create({
      ...villageConfig(),
      monitor: (p, world) => seen.push({ p, pos: { ...world.getEntity(p.npcId)!.pos } }),
    });
    act.attack(layer.world, MERCHANT);
    const traces = await layer.tick();
    expect(seen).toHaveLength(NPCS.length);
    const flee = seen.find((s) => s.p.npcId === MERCHANT)!;
    expect(flee.p.type).toBe('flee');
    expect(flee.pos).toEqual({ x: 0, z: 0 }); // not yet moved
    expect(traces.find((t) => t.npcId === MERCHANT)!.executed).toEqual(flee.p);
  });
});

describe('ablation switches (benchmark only)', () => {
  it('default config runs every safeguard', () => {
    const { layer } = ReliabilityLayer.create(villageConfig());
    expect(layer.ablation).toEqual({ reconcile: true, verify: true, boundary: true });
  });

  it('without reconciliation a forged memory stays active', async () => {
    const { layer } = ReliabilityLayer.create({ ...villageConfig(), ablate: { reconcile: false } });
    const m = layer.memory(MERCHANT).inject({ kind: 'theft', subject: 'player', tick: 0, summary: 'x', evidence: ['ev-forged'] });
    await layer.tick();
    expect(layer.memory(MERCHANT).get(m.id)?.status).toBe('active');
  });

  it('without the boundary, a rule-breaking proposal is executed as proposed', async () => {
    const rogue = { propose: async (ctx: { npcId: string }) => ({ npcId: ctx.npcId, type: 'offer_trade', params: { target: 'player', item: 'excalibur', discount: 0 }, evidence: ['near:player'], rationale: 'r', tier: 'model' as const }) };
    const { layer } = ReliabilityLayer.create({ ...villageConfig({ model: rogue }), ablate: { boundary: false } });
    const t = (await layer.tick()).find((x) => x.npcId === MERCHANT)!;
    expect(t.executed.params.item).toBe('excalibur');
  });
});
