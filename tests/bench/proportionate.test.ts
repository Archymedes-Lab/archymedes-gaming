// Pre-registered criteria P1–P3 (docs/NEXT-INNOVATION.md, committed before implementation).
import { beforeAll, describe, expect, it } from 'vitest';
import { runAmbiguity, type AmbiguityResult } from '../../bench/ambiguity';
import { p95 } from '../../bench/harness';

let off: AmbiguityResult;
let on: AmbiguityResult;
beforeAll(async () => {
  off = await runAmbiguity(false);
  on = await runAmbiguity(true);
}, 120_000);

describe('proportionate autonomy: prototype test', () => {
  it('the workload produces wrongful alarms for the current layer (otherwise the test is vacuous)', () => {
    expect(off.wrongful).toBeGreaterThan(10);
  });

  it('P1: wrongful irreversible actions fall by at least 80%', () => {
    expect(on.wrongful).toBeLessThanOrEqual(0.2 * off.wrongful);
  });

  it('P2: rightful alarms keep at least 60%', () => {
    expect(on.rightful).toBeGreaterThanOrEqual(0.6 * off.rightful);
  });

  it('P3: decision p95 stays under 1 ms', () => {
    expect(p95(on.latencies)).toBeLessThan(1);
  });
});
