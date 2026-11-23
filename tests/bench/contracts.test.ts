// Pre-registered criteria C1–C3 (docs/NEXT-INNOVATION.md, committed before implementation).
import { beforeAll, describe, expect, it } from 'vitest';
import { runContracts, type ContractsResult } from '../../bench/contracts';
import { noisyModel } from '../../bench/noisyModel';

let plain: ContractsResult;
let adversarial: ContractsResult;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

beforeAll(async () => {
  plain = await runContracts();
  adversarial = await runContracts(200, 80, (s) => noisyModel(s, 0.5));
}, 180_000);

describe('commitments as contracts: prototype test', () => {
  it('the workload exercises contracts (otherwise the test is vacuous)', () => {
    expect(plain.checks).toBeGreaterThan(1000);
    expect(plain.pledges).toBeGreaterThan(20);
  });

  it('C1: settlement equals the independent re-derivation in 100% of checks', () => {
    expect(plain.mismatches).toBe(0);
    expect(adversarial.mismatches).toBe(0);
  });

  it('C2: no executed offer undercuts an open pledge, even with a 50%-error model', () => {
    expect(plain.undercuts).toBe(0);
    expect(adversarial.undercuts).toBe(0);
  });

  it('C3: players who keep promises get better offers than players who break them', () => {
    expect(mean(plain.keeperDiscounts)).toBeGreaterThan(mean(plain.breakerDiscounts));
  });
});
