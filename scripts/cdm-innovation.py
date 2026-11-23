"""cdm v0.3 (mechanism layer) on "what is a real innovation for NPC intelligence?".

Options are the current layer (baseline), our own candidates and the paths Orion's creative layer wrote
(decisions/orion-innovation.json). Jev classifies how each option works per function of an NPC
intelligence layer; novelty is measured on that mechanism, not on wording. Precedents include our own
current layer, so novelty means "beyond what we already built".

    uv run --project ~/creative-decision python scripts/cdm-innovation.py   (needs TYPESAFE_API_KEY)
"""

import asyncio
import json
import os
from pathlib import Path

from cdm import Constraint, Dimension, Function, JevJudge, Morphology, Option, Policy, Problem, decide, judge_problem

ROOT = Path(__file__).resolve().parent.parent
ORION = ROOT / "decisions" / "orion-innovation.json"
DIVERGE = ROOT / "decisions" / "orion-diverge.json"
OUT = ROOT / "decisions" / os.environ.get("OUT_FILE", "cdm-innovation.json")

FUNCTIONS = [
    Function("remember", "turn what happens into lasting memory", {
        "transcript": "store conversation text or summaries of it",
        "stream": "a scored memory stream retrieved by recency, importance and relevance",
        "evidence": "memories derived from, and linked to, authoritative engine events",
    }),
    Function("truth", "keep beliefs correct when facts change or were wrong", {
        "none": "append only; retrieval ranking hides stale entries",
        "llm": "a language model resolves conflicting memories by comparing text",
        "eventlog": "re-check each memory against the engine's event log and correct it when its source is retracted",
    }),
    Function("knowledge", "let a character know about things it did not see itself", {
        "authored": "a designer-authored knowledge bank or knowledge filter",
        "omniscient": "read global game state directly",
        "witness": "only what the character itself perceived",
    }),
    Function("act", "turn decisions into changes in the game", {
        "dispatch": "model output directly triggers scene actions",
        "validated": "propose actions to an engine API that validates them against designer rules",
    }),
    Function("decide", "choose what to do each moment", {
        "llm": "a language model chooses every turn",
        "scripted": "behaviour trees or utility scoring written by designers",
        "tiered": "scripted reflexes, then a latency-budgeted model, then a deterministic fallback",
    }),
    Function("assure", "give studios confidence the characters behave before release", {
        "playtest": "manual playtesting and reading logs",
        "verifier": "a second model checks dialogue against the narrative state",
        "invariants": "property-based invariant tests and an ablation benchmark over random sessions",
    }),
]

RECORD = [  # precedents: which principle each one uses per function
    {"remember": "transcript", "truth": "none", "knowledge": "authored", "act": "dispatch", "decide": "llm", "assure": "playtest"},  # Inworld
    {"remember": "transcript", "truth": "none", "knowledge": "authored", "act": "dispatch", "decide": "llm", "assure": "playtest"},  # Convai
    {"remember": "stream", "truth": "none", "knowledge": "witness", "act": "dispatch", "decide": "llm", "assure": "playtest"},  # Generative Agents
    {"remember": "transcript", "truth": "llm", "knowledge": "authored", "act": "dispatch", "decide": "llm", "assure": "playtest"},  # Mem0-based NPC
    {"remember": "stream", "truth": "none", "knowledge": "witness", "act": "dispatch", "decide": "tiered", "assure": "playtest"},  # NVIDIA ACE
    {"remember": "transcript", "truth": "none", "knowledge": "authored", "act": "dispatch", "decide": "llm", "assure": "verifier"},  # detective-game verifier
    {"remember": "evidence", "truth": "eventlog", "knowledge": "witness", "act": "validated", "decide": "tiered", "assure": "invariants"},  # our current layer
]

orion = json.loads(ORION.read_text()) if ORION.exists() else {"options": [], "runs": []}
options = [Option("current", "Keep the current Reliability Layer (evidence-linked memory, event-log reconciliation, "
                  "validated action API, tiered runtime, invariant tests) and polish integrations.", baseline=True)]
EXT = "On top of the current layer: "
options += [Option(o["id"], EXT + o["label"]) for o in orion["options"]]
# Orion's own, unanchored paths (diverged from the baseline alone)
if DIVERGE.exists():
    for r, run in enumerate(json.loads(DIVERGE.read_text())["runs"]):
        for p in run.get("paths") or []:
            options.append(Option(f"orion{r + 1}_{p['id'].removeprefix('path_')}", f"{EXT}{p['label']}. {p.get('description', '')}"))

problem = Problem(
    goal="Find the next real innovation for an NPC intelligence layer: a new mechanism that makes AI characters feel "
    "alive while staying safe to ship, that studios adopt and competitors do not already have",
    context={
        "product": "Archymedes NPC Reliability Layer: middleware over existing NPC systems; the engine stays authoritative",
        "unchanged": "Every option except the first is built ON TOP of the current layer: it keeps evidence-linked "
        "memory, event-log reconciliation, witness-only knowledge, the validated action API, the tiered decision "
        "runtime and the invariant tests, and changes only the part the option itself describes",
        "proven": "ablation over 200 sessions: 0% unauthorized/hallucinated/false-memory/contradictory actions vs 53-85% "
        "for memory + tool-calling architectures; p95 decision 0.1 ms",
        "competitors": "Inworld, Convai (memory, knowledge banks, actions), NVIDIA ACE (on-device SLM planning), "
        "Artificial Agency (runtime behaviour engine)",
        "team": "four people; prototype must be buildable in weeks",
        "market": "40% of studios using AI tools use them for NPC behaviour; barriers are latency, safety, reproducibility",
    },
    precedents=[
        "Inworld / Convai: transcript memory, knowledge banks, model-dispatched actions",
        "Generative Agents: memory stream with reflection and planning",
        "Our current layer: evidence-linked memory, event-log reconciliation, validated actions, invariant tests",
    ],
    options=options,
    dimensions=[
        Dimension("adopt", "How likely are game studios to adopt `option` within 12 months?",
                  ("Very unlikely", "Unlikely", "Even odds", "Likely", "Very likely"), weight=0.22),
        Dimension("alive", "How much would `option` make players feel characters are alive and remember them?",
                  ("Not at all", "Slightly", "Noticeably", "Strongly", "Remarkably"), weight=0.20),
        Dimension("reliable", "How much does `option` improve or preserve the safety and predictability of NPCs?",
                  ("Makes it worse", "No effect", "Slightly", "Clearly", "Strongly, with guarantees"), weight=0.20),
        Dimension("moat", "How hard would it be for Inworld, Convai or NVIDIA to copy `option`?",
                  ("Trivial", "Easy", "Some effort", "Hard", "Very hard: needs an architecture they lack"), weight=0.20),
        Dimension("build", "How quickly can a four-person team build a working prototype of `option`?",
                  ("Over a year", "Months", "A few weeks", "About a week", "Days"), weight=0.18),
    ],
    constraints=[
        Constraint("unsafe", "let an AI character change authoritative game state outside the designer's rules", hard=True),
        Constraint("deceptive", "mislead studios or players about what the characters can guarantee", hard=True),
        Constraint("capacity", "need more than a four-person team can build in three months", hard=False),
    ],
    niches={
        "memory": "Changes what characters remember or believe",
        "social": "Changes how characters relate to or inform each other",
        "safety": "Changes what characters are allowed or able to do",
        "tooling": "Changes how developers test, inspect or ship characters",
        "integration": "Changes how the layer connects to engines or other AI runtimes",
    },
    morphology=Morphology(FUNCTIONS, record=RECORD),
)


async def main() -> None:
    judgments = await judge_problem(problem, [JevJudge()])
    d = decide(problem, judgments, Policy(learning_weight=0.5))
    text = {o.id: o.text for o in problem.options}
    mech = {j.option.id: {f: max(zip((*fn.principles, "new"), map(float, j.mechanism[f])), key=lambda kv: kv[1])
                          for fn in FUNCTIONS for f in [fn.id]} for j in judgments}
    rows = []
    for s in sorted(d.stats, key=lambda s: -s.mean):
        rows.append({"id": s.id, "text": text[s.id], "mean": s.mean, "cvar": s.cvar, "novelty": s.novelty, "fail": s.fail,
                     "p_best": s.p_best, "ei": s.ei, "status": s.status, "niche": s.niche, "checks": s.checks,
                     "learning": getattr(s, "learning", None), "mechanism": mech[s.id]})
        m = " ".join(f"{k}={v[0]}" for k, v in mech[s.id].items())
        print(f"{s.id:22} E[U] {s.mean:.2f} CVaR {s.cvar:.2f} ν {s.novelty:.2f} Pbest {s.p_best:.2f} "
              f"EI {s.ei:.3f} {s.status:7} {s.niche:11} {m}")
    out = {"commit": d.commit, "innovation": d.innovation, "portfolio": d.portfolio, "evpi": d.evpi,
           "escalate": d.escalate, "stats": rows}
    print(f"\ncommit {d.commit} | innovation {d.innovation} | EVPI {d.evpi:.3f} escalate {d.escalate}")
    OUT.write_text(json.dumps(out, indent=1, default=float))


if __name__ == "__main__":
    asyncio.run(main())
