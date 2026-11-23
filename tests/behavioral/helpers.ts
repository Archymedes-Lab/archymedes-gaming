import { ReliabilityLayer } from '../../src/core/layer';
import { InMemoryStorage, type StorageAdapter } from '../../src/core/persistence';
import { villageConfig, type VillageOptions } from '../../src/game/village';
import type { Trace } from '../../src/core/types';

export function newSession(storage: StorageAdapter = new InMemoryStorage(), opts: VillageOptions = {}) {
  return ReliabilityLayer.create(villageConfig(opts), storage);
}

export async function run(layer: ReliabilityLayer, ticks: number): Promise<Trace[]> {
  const all: Trace[] = [];
  for (let i = 0; i < ticks; i++) all.push(...(await layer.tick()));
  return all;
}

export const of = (traces: Trace[], npcId: string) => traces.filter((t) => t.npcId === npcId);

/** Traces minus wall-clock noise, for replay comparison. */
export const stable = (traces: Trace[]) => traces.map(({ latencyMs: _l, ...rest }) => rest);
