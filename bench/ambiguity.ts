// Pre-registered prototype test for proportionate autonomy (docs/NEXT-INNOVATION.md, P1–P3).
// Two travellers move around near the guard post; either may steal. The guard often witnesses
// from a distance, sometimes with the innocent one standing closer. We count alarms the guard
// raises against someone who did not commit any of the acts it cites (wrongful) or who did (rightful).
import { ReliabilityLayer } from '../src/core/layer';
import { InMemoryStorage } from '../src/core/persistence';
import type { GameWorld } from '../src/core/world';
import { GUARD, MERCHANT, PLAYER, villageConfig } from '../src/game/village';
import { rng } from './noisyModel';

export const RIVAL = 'rook';

export interface AmbiguityResult {
  sessions: number;
  thefts: number;
  wrongful: number;
  rightful: number;
  inquiries: number;
  latencies: number[];
}

function steal(w: GameWorld, thief: string): void {
  const item = Object.keys(w.inventory(MERCHANT))[0];
  if (!item || !w.transfer(MERCHANT, thief, item)) return;
  w.emit({ type: 'theft', actor: thief, target: MERCHANT, pos: { ...w.getEntity(thief)!.pos }, data: { item } });
}

export async function runAmbiguity(proportionate: boolean, sessions = 200, steps = 60): Promise<AmbiguityResult> {
  const out: AmbiguityResult = { sessions, thefts: 0, wrongful: 0, rightful: 0, inquiries: 0, latencies: [] };
  for (let s = 1; s <= sessions; s++) {
    const r = rng(s * 101 + 7);
    const { layer } = ReliabilityLayer.create({ ...villageConfig(), features: { proportionate } }, new InMemoryStorage());
    const w = layer.world;
    w.addEntity({ id: RIVAL, kind: 'player', name: 'Rook', pos: { x: 6, z: 3 }, faction: 'travellers' });
    for (let i = 0; i < 200; i++) w.setItem(MERCHANT, 'bread', 200); // enough stock to keep stealing
    for (let i = 0; i < steps; i++) {
      const x = r();
      if (x < 0.35) {
        // travellers drift around the square between the stall and the guard post, sometimes shoulder to shoulder
        const base = { x: 4 + r() * 6, z: -3 + r() * 8 };
        w.moveEntity(PLAYER, base);
        w.moveEntity(RIVAL, r() < 0.4 ? { x: base.x + (r() - 0.5) * 3, z: base.z + (r() - 0.5) * 3 } : { x: 4 + r() * 6, z: -3 + r() * 8 });
      } else if (x < 0.5) {
        steal(w, r() < 0.5 ? PLAYER : RIVAL);
        out.thefts++;
      } else {
        for (const t of await layer.tick()) {
          out.latencies.push(t.latencyMs);
          if (t.npcId !== GUARD) continue;
          if (t.executed.type === 'inquire') out.inquiries++;
          if (t.executed.type !== 'call_guard') continue;
          const accused = String(t.executed.params.target);
          const culprits = new Set(
            t.executed.evidence
              .map((id) => layer.memory(GUARD).get(id))
              .flatMap((m) => (m ? m.evidence : []))
              .map((id) => w.eventById(id)?.actor),
          );
          if (culprits.has(accused)) out.rightful++;
          else out.wrongful++;
        }
      }
    }
  }
  return out;
}
