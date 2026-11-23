# Next innovation: what Orion and cdm chose, and the pre-registered tests

Written **before** implementation (26 Oct 2026). The pass criteria below are fixed now so the result
cannot be tuned to them afterwards.

## How the choice was made

1. **Diverge (Orion).** Orion's creative layer (`scripts/orion-innovation.ts`) was run twice:
   - judging our six candidates against the current layer (`decisions/orion-innovation*.json`, two runs × two questions);
   - diverging *from the baseline alone*, so its ideas were not anchored on ours (`decisions/orion-diverge.json`).

   Jev judged everything and Orion's `creativeDecide` ranked it. Note: the first runs silently failed to
   diverge because our request broke Orion's schema (more than 4 options, labels over 80 characters). This was fixed before the unanchored run.
2. **Converge on mechanism (cdm v0.3).** `scripts/cdm-innovation.py` describes every option by six functions of an
   NPC intelligence layer (remember, truth, knowledge, act, decide, assure) and the known working principles for each.
   Precedents recorded per function: Inworld, Convai, Generative Agents, a Mem0-based NPC, NVIDIA ACE, the detective-game
   verifier, **and our own current layer**. So novelty means "beyond what we already built". Jev classifies how each option
   works per function; cdm gates (clear / verify / reject), values each option as an exact lottery and picks a commit plus
   one innovation bet.
3. **Stability.** cdm was run three times (`decisions/cdm-ext-{1,2,3}.json`). An earlier framing, where options described only
   their change, made Jev guess "new, 50/50" for every function an option didn't mention. Those guesses compounded into
   P(fail) ≈ 0.9 for everything (`decisions/cdm-stability-*.json`). The final framing says what is true: every option
   extends the current layer.

## Result

| | Orion | cdm (3/3 runs) |
|---|---|---|
| Commit | irrev (question 1), promises (question 2) | **irrev**: proportionate autonomy |
| Innovation bet | promises, diff | **promises**: commitments as contracts |
| Gate | — | both **verify**: prototype test of the mechanism + honesty of claims; fallback = current layer |
| Status quo | — | still 55–64% of the portfolio; P(mechanism fails) 0.72–0.80 for both picks |
| Orion's unanchored ideas | audit API, studio beta, open-source invariants, telemetry, mod leaderboard, causality graph | all rejected as *mechanisms* (distribution moves, not new working principles) |

So the decision is to **build both as prototype tests behind switches, and adopt them only if the criteria below pass.**

## 1. Proportionate autonomy (commit)

**Mechanism.** The evidence an action needs scales with how irreversible it is. When the evidence is not
enough, the NPC takes a *reversible probe* (inquire) instead of the irreversible act. This is cdm's own
"unknown → verify, fall back to the status quo" principle, moved inside the NPC.

What it requires: perception becomes an engine fact. When an event happens, the engine records what each
nearby NPC perceived: who it thinks did it, and how sure it is. Ambiguity comes from distance and from
other people standing near the culprit. Memories carry that confidence. Reconciliation checks memories
against the engine's *perception record*, not against ground truth. So NPCs can be honestly wrong, but
never ungrounded.

**Pass criteria** (ambiguity benchmark, 200 seeded sessions, two travellers, guard witnesses at a distance):
- P1. Wrongful irreversible actions (an alarm against someone who did not commit the cited act) fall by at least 80% versus the current layer.
- P2. Rightful alarms keep at least 60% of the current layer's count.
- P3. Every existing invariant, behavioural and functional test still passes; decision p95 stays under 1 ms.

## 2. Commitments as contracts (innovation bet)

**Mechanism.** Promises are obligations *derived from the event log*, never from model text.
- A player's promise has engine-checkable terms (item, quantity, due tick). Gifts fulfil it, and it is kept or broken when re-derived.
- The NPC's own pledges (for example "20% off your next trade") are engine events. The verifier forbids any action that breaks an open pledge.
- Kept/broken memories cite the promise and fulfilment events. If the game retracts a delivery, a "kept" memory is corrected automatically.

**Pass criteria** (contracts benchmark, 200 seeded sessions with promises, deliveries, retractions and reloads):
- C1. Obligation status equals an independent oracle's re-derivation from the event log in 100% of checks, including after retractions and reloads.
- C2. No executed action breaks an open NPC pledge, in the benchmark and under property-based fuzzing with an adversarial model.
- C3. Behaviour responds: players who keep promises receive a higher mean discount than players who break them.
- C4. Every existing test still passes.

## Honesty check (cdm's `deceptive` gate)

Whatever happens, `docs/INNOVATION.md` and this file will report the measured results, including failures.
A criterion that fails means that mechanism stays off by default.

---

## Results (measured after implementation; raw numbers in `prototype-results.json`)

Both mechanisms passed every pre-registered criterion and are **on by default**, per cdm's verify policy:
adopt on pass, fall back to the current layer on fail.

### Proportionate autonomy: passed P1–P3

| | Current layer | Proportionate autonomy | Criterion |
|---|--:|--:|---|
| Wrongful alarms (200 sessions, 1,834 thefts) | 108 | **17** (−84%) | P1: at least 80% fewer ✓ |
| Rightful alarms | 913 | **712** (78%) | P2: at least 60% kept ✓ |
| Reversible inquiries instead | 0 | 1,122 | — |
| Decision p95 | — | 0.12 ms | P3: under 1 ms ✓; all other tests pass ✓ |

### Commitments as contracts: passed C1–C4

| | Plain workload | 50%-error adversarial model | Criterion |
|---|--:|--:|---|
| Settlement vs independent re-derivation | **0** mismatches / 49,170 | **0** / 49,170 | C1: 100% ✓ |
| Offers undercutting an open pledge | **0** / 4,465 | **0** / 4,109 | C2: none ✓ (also fuzzed: `tests/invariants/contracts.property.test.ts`) |
| Mean discount, promise keepers vs breakers | **22.4%** vs **1.8%** | 21.5% vs 3.0% | C3: keepers higher ✓ |
| All other tests | 131 pass | | C4 ✓ |

### What did not go cleanly (cdm's honesty check)

- **P1 passed with a thin margin.** The first measurement was −82%. The 17 remaining wrongful alarms come from repeated
  misperceptions of the *same* innocent person. The certainty measure (1 − Π(1 − cᵢ)) treats observations as independent,
  but position-driven mistakes are correlated. cdm's own paper lists the same limit. A fix would discount repeated
  observations taken from the same vantage point.
- **One design flaw was found visually, after pre-registration.** In the 3D demo, a guard with a 50/50 suspicion still
  soured its relationship with an innocent player, because "consequential" acts required certainty ≥ 0.5. The bar is now
  *more than* the threshold, so a coin flip is never enough (regression test added). This changed no pass threshold. P1–P3 were
  re-measured afterwards (the table above is post-change).
- **The oracle needed updating when contracts were adopted.** Two ablation tests failed because the independent oracle did not
  know the new action types or citations. It was taught the new rules with its own re-derivation (`bench/contractsOracle.ts`),
  plus two new consistency rules (no undercut pledges, no groundless pledges). The full layer still scores 0.0% failures
  against the stricter oracle.
- **Perception realism changed the baseline.** Before this work, witnesses knew *exactly* who did what (omniscient
  attribution). Perception records now make honest mistakes possible. The P1 baseline is the current decision logic under
  realistic perception, not the old omniscient one.
- **Not done:** feeding these outcomes back into cdm's morphology (`Morphology.update`) so the next decision re-prices these
  principles. Settlement cost grows with the event log (`deriveContracts` is O(events) per call), so a production build
  needs an incremental index.
