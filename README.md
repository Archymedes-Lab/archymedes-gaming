# Archymedes NPC Reliability Layer

**Persistent memory · Grounded decisions · Bounded autonomy · Verified behavior**

Middleware that gives existing NPCs evidence-backed memory and grounded, designer-bounded
behaviour, without replacing the game's own systems. The engine stays authoritative.
NPCs only *propose* actions, and the game validates and applies them.

Built test-first. Every capability is specified by functional, behavioural and
property-based invariant tests before implementation.

```bash
bun install
bun run test        # 95 tests: functional, behavioural, invariant (fast-check), ablation claims
bun bench/run.ts    # ablation benchmark → docs/BENCHMARK.md
bun run dev         # three.js village at http://localhost:5173
```

## Is it an innovation?

See [docs/INNOVATION.md](docs/INNOVATION.md): prior-art map, claims, ablation proving each component
necessary and the full layer sufficient (0% failures vs 53–85% for common architectures), threats to validity.

## What's next, chosen by Orion + cdm

[docs/NEXT-INNOVATION.md](docs/NEXT-INNOVATION.md): two mechanisms chosen by Orion's creative layer and cdm v0.3's
mechanism layer, pre-registered, built and adopted after passing:
**proportionate autonomy** (certainty scales with irreversibility; unsure NPCs inquire; wrongful alarms −84%) and
**commitments as contracts** (promises and pledges settled from the event log; 0 undercut pledges).

## Architecture

```
            ┌───────────── authoritative game (GameWorld) ─────────────┐
            │ entities · inventory · quests · relationships · event log │
            └──────▲───────────────────────────────┬────────────────────┘
                   │ execute (validated)           │ events, state
          ┌────────┴────────┐               ┌──────▼───────┐
          │ GameActionAPI   │               │ MemoryStore  │ observe → reconcile → decay
          │ hard boundary   │               │ evidence-    │ (corrects memories the game
          └────────▲────────┘               │ backed       │  no longer backs)
                   │ verify                 └──────┬───────┘
          ┌────────┴────────┐  facts  ┌────────────▼──┐
          │ verify()        │◄────────┤ groundFacts() │ designer knowledge policy
          │ grounded ·      │         └───────────────┘
          │ permitted ·     │◄── TieredRuntime: reflex → model (budgeted) → utility
          │ consistent      │
          └─────────────────┘ → Trace (candidates, evidence, rejections, latency)
```

| Module | Responsibility |
| --- | --- |
| `src/core/world.ts` | Stand-in for the studio engine: the only thing that mutates state |
| `src/core/memory.ts` | Salience, valence, half-life decay, capacity, correction, forgetting, lossless JSON |
| `src/core/grounding.ts` | Fact set from game state, filtered by what the NPC may know |
| `src/core/answer.ts` | Grounded Q&A with citations; "I don't know" instead of invention |
| `src/core/actions.ts` | Action catalog, zone bounds, discount/relationship limits, cooldowns, quest rules |
| `src/core/verify.ts` | Grounded (citations resolve) · permitted (engine accepts) · consistent (no contradiction with memory) |
| `src/core/decide.ts` | Reflex → optional model with latency budget and fallback → deterministic utility |
| `src/core/layer.ts` | Drop-in facade: `tick()`, `ask()`, `save()`, versioned snapshots via a storage adapter |
| `src/game/village.ts` | Sample project: merchant, guard and elder, plus designer config and player verbs |
| `src/viz/*` | three.js visualisation of NPC minds |

## What the tests guarantee

**Invariants** (`tests/invariants`, fast-check, random player behaviour + retractions + memory
corruption + save/reload + a fully adversarial model tier):

- memory never exceeds capacity, ids are unique, salience stays in [0, base]
- every executed action is permitted by the role and passes verification
- every citation resolves to a fact or an active memory backed by a live game event
- NPCs never leave their zone, never create or destroy items, never change quest state
- relationship drift per tick is within the designer's bound
- persistence is lossless (snapshot → save → restore → identical snapshot)
- decisions are a pure function of inputs (replay reproduces them)

**Behaviour** (`tests/behavioral`, the product spec's scenarios):

- merchant remembers a caravan rescue across sessions → discount citing the memory,
  relationship raised through an approved action
- thief refused (theft cited); distant guard knows nothing; witnessing guard raises the alarm
- trivial greetings fade; rescues persist; "forget" is permanent
- fabricated memories are corrected before they are acted on; retracted events restore trade
- contradictory world facts: remembered gift does not override current inventory
- rogue model (invented items, quest completion, leaving zone, 90% discount, fake evidence)
  is blocked, the fallback runs, and the rejection is on the trace
- hung model falls back within budget; utility p95 < 5 ms

## The visualisation

`bun run dev` opens a dusk market village. Each NPC has a **mind panel** over its head:

- **memory**: top memories with salience bars. New ones flash; corrected ones are struck through.
- **decision**: the executed action and its rationale
- **evidence chips**: the facts and memories the decision cites
- **verdict**: ✓ grounded ✓ permitted ✓ consistent, a tier chip (reflex / utility / model / fallback),
  and a red *blocked* banner when the boundary rejects a model proposal
- **memory orbs** orbit the head (teal = positive, red = negative, size = salience).
  A new memory flies from where the event happened into the head; a corrected one greys out and drifts away.
- **evidence beams** link the NPC to whoever and whatever the decision cites
- **zone ring** on the ground shows bounded autonomy and pulses red when something is blocked

Walk with WASD. Near an NPC, press R (rescue), G (gift), P (promise), E (greet), T (steal) or F (attack).
The game-master tools retract events and inject false memories. Switch the model tier to
*Rogue* or *Network down* to watch the boundary and the fallback. **End session & reload** shows memory
surviving across sessions. The inspector (right) shows candidate scores, the memory ledger,
grounded facts, a Q&A box and the trace timeline.

Models: `RobotExpressive.glb` (Tomás Laulhé, CC0) and `Soldier.glb` from the three.js examples.

## Licence

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
