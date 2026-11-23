// How an NPC feels about someone, derived only from its active, evidence-backed memories.
import type { MemoryStore } from './memory';

/** Current feeling: valence weighted by decayed salience and by how sure the NPC is it was them. */
export function netValence(memory: MemoryStore, subject: string): number {
  return memory.recall({ subject }).reduce((s, m) => s + m.valence * m.salience * m.confidence, 0);
}

/**
 * Combined certainty that `subject` did something hostile: 1 − Π(1 − cᵢ) over independent events
 * (memories citing the same events count once, at their highest confidence).
 */
export function support(memory: MemoryStore, subject: string): number {
  const byEvent = new Map<string, number>();
  for (const m of memory.recall({ subject })) {
    if (m.valence >= 0) continue;
    const key = [...m.evidence].sort().join('|');
    byEvent.set(key, Math.max(byEvent.get(key) ?? 0, m.confidence));
  }
  return 1 - [...byEvent.values()].reduce((p, c) => p * (1 - c), 1);
}

/** Relationship score the memories justify, on the engine's -100..100 scale. */
export function relationshipTarget(memory: MemoryStore, subject: string): number {
  const raw = memory.recall({ subject }).reduce((s, m) => s + m.valence * m.baseSalience * m.confidence * 50, 0);
  return Math.max(-100, Math.min(100, Math.round(raw)));
}
