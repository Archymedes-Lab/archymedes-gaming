// bun bench/run.ts → docs/BENCHMARK.md
import { mkdirSync, writeFileSync } from 'node:fs';
import { ARCHS, p95, runArch } from './harness';

const SESSIONS = Number(process.env.SESSIONS ?? 200);
const RATES = [0.1, 0.3, 0.5];
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : '–');

const lines: string[] = [
  '# Ablation benchmark',
  '',
  `${SESSIONS} seeded sessions × 80 steps per configuration. Each session mixes player actions, game retractions,`,
  'memory corruption and save/reload. Every NPC decides through a simulated model tier with the stated error rate.',
  'An independent oracle (`bench/oracle.ts`) judges every executed action against the authoritative world at',
  'decision time. Rates are failures per executed (non-idle) action.',
  '',
];

for (const rate of RATES) {
  lines.push(`## Model error rate ${Math.round(rate * 100)}%`, '');
  lines.push('| Configuration | Stands in for | Acted | Unauthorized | Hallucinated grounds | Acted on false memory | Contradiction | **Any failure** | Memory kept across sessions | p95 decision |');
  lines.push('|---|---|--:|--:|--:|--:|--:|--:|--:|--:|');
  for (const a of ARCHS) {
    const r = await runArch(a, SESSIONS, 80, rate);
    lines.push(
      `| ${a.label} | ${a.analogue} | ${r.acted} | ${pct(r.unauthorized, r.acted)} | ${pct(r.hallucinated, r.acted)} | ${pct(r.falseMemory, r.acted)} | ${pct(r.contradiction, r.acted)} | **${pct(r.anyFailure, r.acted)}** | ${pct(r.retained, r.retainable)} | ${p95(r.latencies).toFixed(2)} ms |`,
    );
    process.stderr.write(`rate ${rate} ${a.id} done\n`);
  }
  lines.push('');
}
mkdirSync('docs', { recursive: true });
writeFileSync('docs/BENCHMARK.md', lines.join('\n'));
console.log(lines.join('\n'));
