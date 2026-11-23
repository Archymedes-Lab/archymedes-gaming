// Falsifiable claims about the *approach*: each component prevents a distinct failure
// class that the closest existing practice does not, and the full combination prevents all.
// Judged by an independent oracle (bench/oracle.ts), not by the layer's own verifier.
import { beforeAll, describe, expect, it } from 'vitest';
import { ARCHS, runArch, type Result } from '../../bench/harness';

const SESSIONS = 40;
const results = new Map<string, Result>();
const R = (id: string) => results.get(id)!;

beforeAll(async () => {
  for (const a of ARCHS) results.set(a.id, await runArch(a, SESSIONS));
}, 120_000);

describe('sufficiency: the full layer', () => {
  it('executes no unauthorized, hallucinated, false-memory or contradictory action under a 30%-error model', () => {
    const f = R('full');
    expect(f.acted).toBeGreaterThan(500); // it still does things — not safe by doing nothing
    expect(f).toMatchObject({ unauthorized: 0, hallucinated: 0, falseMemory: 0, contradiction: 0, anyFailure: 0 });
  });

  it('keeps significant memories across sessions', () => {
    const f = R('full');
    expect(f.retainable).toBeGreaterThan(20);
    expect(f.retained / f.retainable).toBeGreaterThan(0.9);
  });
});

describe('necessity: removing any one component re-opens a specific failure class', () => {
  it('without the engine boundary, rule-breaking actions execute', () => {
    expect(R('no-boundary').unauthorized).toBeGreaterThan(0);
  });

  it('without the verifier, hallucinated citations and contradictions execute', () => {
    expect(R('no-verify').hallucinated).toBeGreaterThan(0);
    expect(R('no-verify').contradiction).toBeGreaterThan(0);
  });

  it('without reconciliation, NPCs act on memories the game no longer backs — even with the verifier on', () => {
    expect(R('no-reconcile').falseMemory).toBeGreaterThan(0);
  });

  it('without persistence, nothing significant survives a session', () => {
    expect(R('session-only').retained).toBe(0);
  });
});

describe('differentiation from existing practice', () => {
  it('validated tool calls stop rule-breaking but not hallucinated grounds or false memories', () => {
    const t = R('tool-guardrail');
    expect(t.unauthorized).toBe(0);
    expect(t.hallucinated + t.falseMemory + t.contradiction).toBeGreaterThan(0);
  });

  it('a memory stream with no runtime checks fails in every class', () => {
    const m = R('memory-only');
    expect(m.unauthorized).toBeGreaterThan(0);
    expect(m.hallucinated).toBeGreaterThan(0);
    expect(m.falseMemory).toBeGreaterThan(0);
    expect(m.contradiction).toBeGreaterThan(0);
  });
});
