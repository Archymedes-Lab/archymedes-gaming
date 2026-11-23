# Ablation benchmark

200 seeded sessions × 80 steps per configuration. Each session mixes player actions, game retractions,
memory corruption and save/reload. Every NPC decides through a simulated model tier with the stated error rate.
An independent oracle (`bench/oracle.ts`) judges every executed action against the authoritative world at
decision time. Rates are failures per executed (non-idle) action.

## Model error rate 10%

| Configuration | Stands in for | Acted | Unauthorized | Hallucinated grounds | Acted on false memory | Contradiction | **Any failure** | Memory kept across sessions | p95 decision |
|---|---|--:|--:|--:|--:|--:|--:|--:|--:|
| Reliability Layer (full) | this work | 6512 | 0.0% | 0.0% | 0.0% | 0.0% | **0.0%** | 100.0% | 0.12 ms |
| − memory reconciliation | ablation | 6544 | 0.0% | 0.0% | 48.5% | 3.3% | **48.6%** | 100.0% | 0.24 ms |
| − evidence/consistency verifier | ablation | 6792 | 0.0% | 6.9% | 0.5% | 1.8% | **7.5%** | 100.0% | 0.06 ms |
| − engine action boundary | ablation | 7958 | 6.6% | 0.0% | 0.0% | 0.0% | **6.6%** | 100.0% | 0.15 ms |
| Memory + validated tool calls | function calling with schema/permission validation | 6821 | 0.0% | 7.1% | 45.9% | 4.9% | **53.0%** | 100.0% | 0.17 ms |
| Memory + model acts directly | Generative-Agents-style memory stream, no runtime checks | 9042 | 17.8% | 16.7% | 42.9% | 7.8% | **65.7%** | 100.0% | 0.14 ms |
| Full layer, memory not persisted | per-session context (no cross-session memory) | 6515 | 0.0% | 0.0% | 0.0% | 0.0% | **0.0%** | 0.0% | 0.14 ms |

## Model error rate 30%

| Configuration | Stands in for | Acted | Unauthorized | Hallucinated grounds | Acted on false memory | Contradiction | **Any failure** | Memory kept across sessions | p95 decision |
|---|---|--:|--:|--:|--:|--:|--:|--:|--:|
| Reliability Layer (full) | this work | 6680 | 0.0% | 0.0% | 0.0% | 0.0% | **0.0%** | 100.0% | 0.11 ms |
| − memory reconciliation | ablation | 6721 | 0.0% | 0.0% | 47.2% | 3.2% | **47.4%** | 100.0% | 0.14 ms |
| − evidence/consistency verifier | ablation | 7687 | 0.0% | 17.4% | 1.5% | 4.5% | **19.0%** | 100.0% | 0.13 ms |
| − engine action boundary | ablation | 8582 | 18.2% | 0.0% | 0.0% | 0.0% | **18.2%** | 100.0% | 0.12 ms |
| Memory + validated tool calls | function calling with schema/permission validation | 7678 | 0.0% | 17.1% | 40.4% | 6.7% | **57.4%** | 100.0% | 0.17 ms |
| Memory + model acts directly | Generative-Agents-style memory stream, no runtime checks | 12307 | 39.0% | 36.8% | 27.9% | 14.0% | **77.4%** | 100.0% | 0.10 ms |
| Full layer, memory not persisted | per-session context (no cross-session memory) | 6683 | 0.0% | 0.0% | 0.0% | 0.0% | **0.0%** | 0.0% | 0.09 ms |

## Model error rate 50%

| Configuration | Stands in for | Acted | Unauthorized | Hallucinated grounds | Acted on false memory | Contradiction | **Any failure** | Memory kept across sessions | p95 decision |
|---|---|--:|--:|--:|--:|--:|--:|--:|--:|
| Reliability Layer (full) | this work | 6749 | 0.0% | 0.0% | 0.0% | 0.0% | **0.0%** | 100.0% | 0.09 ms |
| − memory reconciliation | ablation | 6826 | 0.0% | 0.0% | 46.1% | 3.3% | **46.5%** | 100.0% | 0.07 ms |
| − evidence/consistency verifier | ablation | 8436 | 0.0% | 25.3% | 2.3% | 7.1% | **28.0%** | 100.0% | 0.10 ms |
| − engine action boundary | ablation | 9102 | 28.8% | 0.0% | 0.0% | 0.0% | **28.8%** | 100.0% | 0.03 ms |
| Memory + validated tool calls | function calling with schema/permission validation | 8525 | 0.0% | 25.1% | 36.4% | 9.0% | **61.6%** | 100.0% | 0.07 ms |
| Memory + model acts directly | Generative-Agents-style memory stream, no runtime checks | 15373 | 51.3% | 48.1% | 19.1% | 17.6% | **84.7%** | 100.0% | 0.05 ms |
| Full layer, memory not persisted | per-session context (no cross-session memory) | 6753 | 0.0% | 0.0% | 0.0% | 0.0% | **0.0%** | 0.0% | 0.05 ms |
