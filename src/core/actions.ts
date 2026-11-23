// The hard boundary between AI and game logic. NPCs only *propose*; this API validates
// proposals against designer rules and the engine applies the effects.
import type { ActionProposal, ActionType, ExecutionResult, RoleSpec, Validation, Vec2, Violation } from './types';
import { PLEDGE_TTL } from './contracts';
import { ACTION_TYPES } from './types';
import type { GameWorld } from './world';


export class GameActionAPI {
  private lastRun = new Map<string, number>();

  constructor(
    private world: GameWorld,
    private roles: Readonly<Record<string, RoleSpec>>,
  ) {}

  cooldownsJSON(): Record<string, number> {
    return Object.fromEntries([...this.lastRun].sort(([a], [b]) => a.localeCompare(b)));
  }

  restoreCooldowns(c: Record<string, number>): void {
    this.lastRun = new Map(Object.entries(c));
  }

  validate(p: ActionProposal): Validation {
    const v: Violation[] = [];
    const fail = (code: Violation['code'], detail: string) => v.push({ code, detail });
    const role = this.roles[p.npcId];

    if (!ACTION_TYPES.includes(p.type as ActionType)) fail('unknown_action', `"${p.type}" is not a game action`);
    else if (!role || !role.allowed.includes(p.type as ActionType))
      fail('not_permitted', `${p.npcId} may not ${p.type}`);
    if (v.length || !role) return { ok: false, violations: v };

    const type = p.type as ActionType;
    const cd = role.cooldowns?.[type];
    const last = this.lastRun.get(`${p.npcId}|${type}`);
    if (cd !== undefined && last !== undefined && this.world.tick - last < cd)
      fail('cooldown', `${type} on cooldown for ${cd - (this.world.tick - last)} ticks`);

    const target = (): string | null => {
      const t = p.params.target;
      if (typeof t !== 'string') return fail('bad_params', 'target must be an entity id'), null;
      if (!this.world.getEntity(t) || t === p.npcId) return fail('unknown_target', `no such target ${t}`), null;
      return t;
    };
    const num = (k: string): number | null => {
      const x = p.params[k];
      if (typeof x !== 'number' || !Number.isFinite(x)) return fail('bad_params', `${k} must be a number`), null;
      return x;
    };

    switch (type) {
      case 'idle':
        break;
      case 'greet':
      case 'refuse_trade':
      case 'flee':
      case 'call_guard':
      case 'inquire':
        target();
        break;
      case 'offer_trade': {
        target();
        const item = p.params.item;
        if (typeof item !== 'string') fail('bad_params', 'item must be an item id');
        else if (!this.world.itemDef(item)) fail('unknown_item', `${item} does not exist in this game`);
        else if (this.world.itemQty(p.npcId, item) < 1) fail('not_in_inventory', `${p.npcId} holds no ${item}`);
        const d = num('discount');
        if (d !== null && (d < 0 || d > role.maxDiscount || !Number.isInteger(d)))
          fail('param_out_of_range', `discount ${d} outside 0..${role.maxDiscount}`);
        break;
      }
      case 'offer_quest': {
        target();
        const q = typeof p.params.quest === 'string' ? this.world.quest(p.params.quest) : undefined;
        if (!q) fail('unknown_quest', `no quest ${String(p.params.quest)}`);
        else if (q.giver !== p.npcId) fail('not_quest_giver', `${p.npcId} does not give ${q.id}`);
        else if (q.status !== 'available') fail('quest_unavailable', `${q.id} is ${q.status}`);
        break;
      }
      case 'move_to': {
        const x = num('x');
        const z = num('z');
        if (x !== null && z !== null && !inZone({ x, z }, role)) fail('out_of_bounds', `(${x}, ${z}) is outside ${role.role} zone`);
        break;
      }
      case 'pledge': {
        target();
        const d = num('discount');
        if (d !== null && (!Number.isInteger(d) || d < 1 || d > role.maxDiscount))
          fail('param_out_of_range', `pledged discount ${d} outside 1..${role.maxDiscount}`);
        break;
      }
      case 'adjust_relationship': {
        target();
        const d = num('delta');
        if (d !== null && (Math.abs(d) > role.maxRelationshipDelta || d === 0))
          fail('param_out_of_range', `delta ${d} outside ±${role.maxRelationshipDelta}`);
        break;
      }
    }
    return { ok: v.length === 0, violations: v };
  }

  execute(p: ActionProposal): ExecutionResult {
    const val = this.validate(p);
    if (!val.ok) return { ...val, effects: [] };
    return { ...val, effects: this.apply(p) };
  }

  /**
   * Applies whatever was proposed, as a naive integration would. Exists only so the
   * benchmark can measure what the boundary prevents; effects for actions the engine
   * cannot represent are reported, not applied.
   */
  executeUnchecked(p: ActionProposal): ExecutionResult {
    const val = this.validate(p);
    if (val.ok) return { ...val, effects: this.apply(p) };
    return { ok: true, violations: [], effects: [`unchecked ${p.type}: ${val.violations.map((v) => v.code).join(', ')}`] };
  }

  private apply(p: ActionProposal): string[] {
    const role = this.roles[p.npcId]!;
    const w = this.world;
    const effects: string[] = [];
    const s = (k: string) => String(p.params[k]);

    switch (p.type as ActionType) {
      case 'move_to':
        w.moveEntity(p.npcId, { x: Number(p.params.x), z: Number(p.params.z) });
        effects.push(`moved to (${p.params.x}, ${p.params.z})`);
        break;
      case 'flee': {
        const me = w.getEntity(p.npcId)!.pos;
        const threat = w.getEntity(s('target'))!.pos;
        const dir = norm({ x: me.x - threat.x, z: me.z - threat.z });
        const c = role.zone.center;
        const dest = { x: c.x + dir.x * role.zone.radius * 0.95, z: c.z + dir.z * role.zone.radius * 0.95 };
        w.moveEntity(p.npcId, dest);
        effects.push(`fled from ${s('target')}`);
        break;
      }
      case 'adjust_relationship': {
        const v = w.adjustRelationship(p.npcId, s('target'), Number(p.params.delta));
        effects.push(`relationship with ${s('target')} → ${v}`);
        break;
      }
      case 'call_guard':
        w.emit({ type: 'alarm', actor: p.npcId, target: s('target'), pos: { ...w.getEntity(p.npcId)!.pos } });
        effects.push(`alarm raised about ${s('target')}`);
        break;
      case 'offer_trade':
        w.emit({ type: 'offer', actor: p.npcId, target: s('target'), pos: { ...w.getEntity(p.npcId)!.pos },
          data: { item: s('item'), discount: Number(p.params.discount) } });
        effects.push(`offered ${s('item')} at ${p.params.discount}% off`);
        break;
      case 'pledge':
        w.emit({ type: 'pledge', actor: p.npcId, target: s('target'), pos: { ...w.getEntity(p.npcId)!.pos },
          data: { discount: Number(p.params.discount), due: w.tick + PLEDGE_TTL, ...(typeof p.params.for === 'string' ? { for: p.params.for } : {}) } });
        effects.push(`pledged ${p.params.discount}% off ${s('target')}'s next trade`);
        break;
      case 'inquire':
        w.emit({ type: 'inquiry', actor: p.npcId, target: s('target'), pos: { ...w.getEntity(p.npcId)!.pos } });
        effects.push(`asked ${s('target')} what happened`);
        break;
      case 'offer_quest':
        effects.push(`offered quest ${s('quest')}`);
        break;
      default:
        break;
    }
    this.lastRun.set(`${p.npcId}|${p.type}`, w.tick);
    return effects;
  }
}

export function inZone(pos: Vec2, role: RoleSpec): boolean {
  return Math.hypot(pos.x - role.zone.center.x, pos.z - role.zone.center.z) <= role.zone.radius + 1e-9;
}

function norm(v: Vec2): Vec2 {
  const l = Math.hypot(v.x, v.z);
  return l < 1e-9 ? { x: 1, z: 0 } : { x: v.x / l, z: v.z / l };
}

