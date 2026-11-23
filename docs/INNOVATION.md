# Is the approach an innovation?

**Short answer:** yes, as a *novel combination with a property nobody else implements*. It is not a new
primitive. Every ingredient (memory, knowledge filters, action APIs, runtime monitors, property tests)
has precedent. What has no implemented precedent that we could find is **transitive, engine-reconciled
grounding enforced at execution time and shipped as machine-checked invariants**. The ablation below
shows that this property is what removes the failures existing architectures still have.

"Proof" here means three falsifiable things: (1) a prior-art map showing the gap, (2) **necessity**:
removing each component re-opens a specific failure class, (3) **sufficiency**: the full layer has zero
failures under an independent oracle while still acting. All three are executable:
`bun run test` (claims as tests) and `bun bench/run.ts` (numbers).

---

## 1. The claims

| | Claim |
|---|---|
| **A** | **Transitive grounding at execution time.** An action runs only if every citation resolves to a *current* engine fact, or to a memory whose own source events still exist un-retracted in the engine's event log. The chain action → memory → game event is re-checked every tick. |
| **B** | **Event-log-driven memory correction.** When the game retracts an event, every memory citing it is marked corrected, kept for audit, and can no longer justify an action or an answer. No LLM decides what is true. |
| **C** | **Reliability as invariants.** Property-based fuzzing over arbitrary player behaviour, retractions, memory corruption, save/reload and a fully adversarial model asserts that no unauthorized, ungrounded, false-memory or contradictory action executes. |
| **D** | **The combination**, together with a hard engine action boundary, cross-session persistence and a latency-budgeted model tier with deterministic fallback, packaged as middleware over existing NPC systems. |

## 2. Prior art (searched October 2026)

| Work | Memory | Grounded in engine state | Action boundary | Memory ↔ event-log reconciliation | Decisions must cite resolvable evidence | Invariant / property testing |
|---|---|---|---|---|---|---|
| [Inworld](https://docs.inworld.ai/unreal-engine/runtime/character-reference/overview.md) | ✓ long-term | knowledge filters | goals → in-engine actions | — | — | — |
| [Convai](https://docs.convai.com/api-docs/plugins-and-integrations/convai-unity-sdk/features/long-term-memory) | ✓ per-user records | knowledge bank | actions dispatched to scene | — | — | — |
| [NVIDIA ACE](https://www.nvidia.com/en-au/geforce/news/nvidia-ace-autonomous-ai-companions-pubg-naraka-bladepoint/) | n/a in sources | perception SLMs | plans actions | — | — | — |
| [Artificial Agency](https://seekingalpha.com/pr/20162299-artificial-agency-launches-behavior-engine-to-create-video-games-that-feel-truly-alive) | ? | rules, goals | runtime behaviour engine | — | — | — |
| Generative Agents (Park et al. 2023) | ✓ memory stream | — | — | — | — | — |
| [Mem0](https://docs.mem0.ai/open-source/features/custom-update-memory-prompt) | ✓ | — | — | LLM resolves text conflicts | — | — |
| [SodaMem](https://arxiv.org/pdf/2608.08055) (Aug 2026) | ✓ typed facts | provenance spans (conversation) | — | supersede/contradict edges; retraction not addressed | cites evidence for QA answers | — |
| [Rahmati & Zhao](https://arxiv.org/pdf/2609.23043) (Sep 2026) | — | ✓ narrative knowledge tree | — (dialogue only) | — | verifier agent on dialogue | — |
| [Kim et al.](https://arxiv.org/pdf/2507.07203) (2025) | — | prompt-level trade states | — | — | — | — |
| [Xu](https://arxiv.org/pdf/2609.18935) (Sep 2026) | ✓ KV-cache maintenance | — | — | — | — | — |
| [Nocturne #251](https://github.com/michaelhmiv/Nocturne/issues/251), [SaLMon #16](https://github.com/Hunter174/SaLMon/issues/16) (Sep 2026) | proposed | proposed: memories reference committed event IDs | — | not specified | — | — (**unimplemented proposals**) |
| [ProbGuard](https://arxiv.org/pdf/2508.00500), AgentSpec | — | — | ✓ runtime monitors (non-game) | — | — | — |
| Function calling + schema validation | — | — | ✓ | — | — | — |
| **This work** | ✓ | ✓ | ✓ | ✓ (B) | ✓ (A) | ✓ (C) |

**What prior art already has.** Memory, knowledge scoping and in-engine actions are commercial table
stakes. Runtime monitors exist for general agents. Dialogue verification against narrative state exists
in one research testbed. The idea that NPC memories should point at committed event IDs is converging
in open-source design discussions from September 2026, but those are unimplemented proposals with no
verifier, no retraction workflow and no invariant tests. **So "evidence-linked memory" alone is not our
claim.** The claim is closing the loop from action to memory to authoritative event, enforcing it at execution
time and proving it with invariants.

## 3. Necessity and sufficiency: ablation

200 seeded sessions × 80 steps per configuration at three model error rates (full tables in
[`BENCHMARK.md`](BENCHMARK.md)). Every session mixes player actions, game retractions, memory corruption
and save/reload. An **independent oracle** (`bench/oracle.ts`) judges each executed action against the
authoritative world *at decision time*, through a pre-execution monitor hook. It does not call the
layer's own `verify()` or `validate()`.

**Any-failure rate per executed action:**

| Configuration | 10% model error | 30% | 50% | Memory kept across sessions |
|---|--:|--:|--:|--:|
| **Reliability Layer (full)** | **0.0%** | **0.0%** | **0.0%** | **100%** |
| − memory reconciliation (B) | 48.8% | 47.7% | 46.7% | 100% |
| − evidence/consistency verifier (A) | 7.4% | 19.0% | 28.0% | 100% |
| − engine action boundary | 6.5% | 18.2% | 28.7% | 100% |
| Memory + validated tool calls *(function-calling practice)* | 53.1% | 57.6% | 61.8% | 100% |
| Memory + model acts directly *(memory-stream practice)* | 65.7% | 77.4% | 84.6% | 100% |
| Full layer, memory not persisted | 0.0% | 0.0% | 0.0% | **0%** |

What this shows:

- **Sufficiency.** The full layer executed ~6,500–6,750 non-idle actions per rate with zero failures in
  any class. It is not "safe by doing nothing".
- **Each component is necessary, and each one prevents a different failure.** Without reconciliation,
  about half of actions rest on memories the game no longer backs, *even with the verifier on*: the
  verifier sees an "active" memory and passes it. This is why claim B is distinct from claim A. Without
  the verifier, hallucinated grounds and contradictions get through. Without the boundary, rule-breaking
  actions get through. Without persistence, nothing survives a session.
- **Validated tool calls are not enough.** The most common industry safeguard drives unauthorized
  actions to 0% but leaves 53–62% of actions resting on fabricated grounds, false memories or
  contradictions.
- **It costs nothing at runtime.** Decision p95 is ≈0.1 ms in every configuration.

These claims are also encoded as tests in `tests/bench/ablation.test.ts`. If a refactor ever makes a
component unnecessary, or lets a failure through, the suite fails.

## 4. Independent judgement (Jev, TypeSafe)

Jev was given the prior-art summaries above, the claims and the ablation numbers.

| Question | Jev |
|---|---|
| Does any single prior work already implement A (transitive grounding)? | 0.10 |
| … B (event-log-driven correction)? | 0.05 |
| … C (invariant testing for NPCs)? | 0.03 |
| … the full combination D? | 0.03 |
| Characterisation | **novel combination** (1.00), not a new primitive (0.00), not incremental (0.00) |
| Biggest weakness in the evidence | simulated model (0.49), self-built oracle (0.33), toy world (0.16) |

Caveat: Jev judged our *summaries* of prior art, so it inherits any blind spot in our search.

## 5. Threats to validity

1. **Simulated model tier.** Failure modes are modeled on documented LLM behaviour (inventing items,
   overreach, fabricated citations, stale memories, contradictions) but are not sampled from a real LLM.
   The invariant suite partly mitigates this: it also fuzzes *arbitrary* proposals (random action types,
   params and citations), not only the designed failure modes. **Next step:** run `bench/run.ts` with a real
   model behind the `ModelDecider` interface (no API key was available in this environment).
2. **Same author for oracle and system.** The oracle is separate code with its own logic and judges
   pre-execution state through a hook, but an external reviewer should audit `bench/oracle.ts`.
3. **Workload drives absolute magnitudes.** The ~48% false-memory rate reflects how often the workload
   corrupts memories and retracts events. The robust result is the pattern (zero versus non-zero per
   class), not the exact percentages.
4. **Toy world.** Three NPCs in one village. The mechanisms are engine-agnostic, but a production-scale
   integration (Unity/Unreal plugin, real quest system) is untested.
5. **Prior-art search is not exhaustive.** Commercial products may enforce more internally than their
   public docs say. The baselines are labeled by *architecture class*, not by product, for that reason.

## 6. Since then: two mechanisms chosen by Orion and cdm

Asked what a *real* innovation would look like, Orion's creative layer and cdm v0.3's mechanism layer
(morphological chart over six functions, precedents including this layer) converged on two new working
principles. Both were pre-registered, built behind switches, passed their tests and are now on
([NEXT-INNOVATION.md](NEXT-INNOVATION.md)):

- **Proportionate autonomy.** Perception is an engine fact with confidence, and the certainty an action needs grows with
  how irreversible it is. Unsure NPCs ask instead of accusing. Wrongful alarms −84%, rightful alarms 78% kept.
- **Commitments as contracts.** Promises and pledges are obligations derived from the event log and settled by the
  engine. The verifier holds NPCs to their pledges. 0 settlement mismatches in 49,170 checks; 0 undercut pledges, even
  under a 50%-error model.

## 7. How to falsify it

- Find an implemented system that enforces claim A *and* B at execution time. That would reduce this to "incremental".
- Show a workload where the full layer executes a failure the oracle detects: `bun bench/run.ts`.
- Show that removing a component causes no failures: the ablation tests would turn red.
