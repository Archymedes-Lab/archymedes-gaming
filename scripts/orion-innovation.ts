// Orion's creative layer on "what would a real innovation in NPC intelligence look like?".
// Paths are written by a general model (diverge), judged by Jev, ranked by creativeDecide().
// Run from ~/orion so its .env loads:
//   cd ~/orion && ORION_COMPAT_DISCOVER=1 bun ~/archymedes-gaming/scripts/orion-innovation.ts
import path from "node:path";
import os from "node:os";

const ORION = path.join(os.homedir(), "orion");
const { creativeWithAI } = await import(path.join(ORION, "server/creative.ts"));
const { creativeDecide } = await import(path.join(ORION, "src/decision-engine/creative.ts"));
const OUT = path.join(os.homedir(), "archymedes-gaming/decisions", process.env.OUT_FILE ?? "orion-innovation.json");

const FACTORS = [
  { id: "adopt", label: "Studios adopt it within 12 months", weight: 0.2 },
  { id: "reliable", label: "Makes NPCs measurably more reliable", weight: 0.16 },
  { id: "moat", label: "Hard for Inworld/Convai/ACE to copy", weight: 0.16 },
  { id: "player", label: "Players notice and value it", weight: 0.14 },
  { id: "dropin", label: "Drops into existing NPC systems", weight: 0.12 },
  { id: "build", label: "Small team can prototype it in weeks", weight: 0.12 },
  { id: "cheap", label: "Low runtime cost and latency", weight: 0.1 },
];

const BASE = `PRODUCT: Archymedes NPC Reliability Layer, middleware for game studios (Unity/Unreal later). Already built and benchmarked:
memories linked to engine event ids and auto-corrected when the game retracts an event; every NPC action must cite evidence that resolves
to current engine facts or valid memories; a hard engine action API (designer whitelist, zones, bounds, cooldowns); a tiered runtime
(reflex, latency-budgeted LLM, deterministic utility fallback); cross-session persistence; property-based invariant tests; an ablation
benchmark showing 0% unauthorized/hallucinated/false-memory/contradictory actions vs 53-85% for memory + tool-calling architectures.
PRIOR ART: Inworld and Convai ship long-term memory, knowledge banks and in-engine actions; NVIDIA ACE ships on-device perception/planning
SLMs; Artificial Agency a runtime behaviour engine; Generative Agents memory streams; Mem0 LLM-resolved memory conflicts; research on
dialogue verification against narrative state. Market: 40% of studios using AI tools use them for NPC behaviour; barriers are latency,
safety and reproducibility.`;

const ASKS = [
  "DECISION: What is the next real innovation for this layer: a new mechanism (not a feature) that no competitor implements, that makes AI NPCs feel alive while staying safe to ship?",
  "DECISION: What unconventional capability would make studios and players say 'NPCs have never done this before', built on the reliability guarantees already in place?",
];

const MINE = [
  { id: "hearsay", label: "Epistemic NPCs: rumours spread with provenance chains and trust; hearsay never justifies irreversible acts" },
  { id: "irrev", label: "Evidence thresholds scale with action irreversibility; uncertain NPCs probe (ask, check) before acting" },
  { id: "diff", label: "Behaviour diffs: replay recorded sessions against a changed config/model and show which decisions changed and why" },
  { id: "pcc", label: "Proof-carrying actions: any third-party AI runtime submits actions with a certificate the engine checks cheaply" },
  { id: "promises", label: "Commitments as contracts: NPC and player promises tracked as obligations verified against engine state" },
  { id: "consensus", label: "World-consistent cast: no two NPCs ever assert contradictory facts about authoritative state" },
];

const env = process.env as Record<string, string>;
const runs = [];
for (const ask of ASKS) {
  const input = {
    context: `${BASE}\n${ask}`, stakes: "significant" as const, paths: 3,
    // JUDGE_MINE=1 also judges our own candidates; otherwise Orion diverges from the baseline alone (unanchored)
    options: [{ id: "current", label: "Keep the current Reliability Layer and polish integrations" },
      ...(env.JUDGE_MINE ? MINE.slice(0, 3).map((m) => ({ id: m.id, label: m.label.slice(0, 80) })) : [])],
    factors: FACTORS.map(({ id, label }) => ({ id, label })),
  };
  const res = await creativeWithAI(input, { env, typesafeKey: env.TYPESAFE_API_KEY, divergeBudgetMs: Number(env.DIVERGE_MS ?? 180_000), timeoutMs: 90_000 });
  let decision = null;
  if (res.judgments?.length) {
    const levels = res.judgments[0].dims[FACTORS[0].id]?.length ?? 5;
    decision = creativeDecide(
      { dimensions: FACTORS.map((f) => ({ id: f.id, weight: f.weight, levels })),
        limits: res.limits.map((l: { id: string; hard: boolean; checkOnly?: boolean }) => ({ id: l.id, hard: l.hard, checkOnly: l.checkOnly })) },
      res.judgments,
    );
  }
  const stats = decision?.stats.map((s: { id: string; status: string; mean: number; novelty: number; niche: string; pBest: number; ei: number; checks: string[] }) =>
    ({ id: s.id, status: s.status, mean: +s.mean.toFixed(3), novelty: +s.novelty.toFixed(2), niche: s.niche, pBest: +s.pBest.toFixed(2), ei: +s.ei.toFixed(3), checks: s.checks }));
  runs.push({ ask, judge: res.judge, divergeFailed: res.divergeFailed, paths: res.paths, commit: decision?.commit, innovation: decision?.innovation, portfolio: decision?.portfolio, stats });
  console.log(JSON.stringify(runs.at(-1), null, 1));
}
await Bun.write(OUT, JSON.stringify({ runAt: new Date().toISOString(), factors: FACTORS, options: MINE, runs }, null, 1));
