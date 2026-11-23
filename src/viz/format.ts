// Human-readable renderings of layer data for the HUD and inspector.
import type { ActionProposal, Memory } from '../core/types';

export type Namer = (id: string) => string;

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function humanize(text: string, name: Namer): string {
  return text.replace(/\b(player|mira|bram|elda|rook)\b/g, (id) => name(id));
}

export function fmtAction(p: ActionProposal, name: Namer): string {
  const t = typeof p.params.target === 'string' ? name(p.params.target) : '';
  switch (p.type) {
    case 'offer_trade':
      return `offer ${p.params.item}${Number(p.params.discount) ? ` −${p.params.discount}%` : ''} → ${t}`;
    case 'refuse_trade':
      return `refuse trade → ${t}`;
    case 'adjust_relationship':
      return `relationship ${Number(p.params.delta) > 0 ? '+' : ''}${p.params.delta} → ${t}`;
    case 'offer_quest':
      return `offer quest “${p.params.quest}” → ${t}`;
    case 'flee':
      return `flee from ${t}`;
    case 'call_guard':
      return `raise alarm on ${t}`;
    case 'move_to':
      return `move to (${Number(p.params.x).toFixed(1)}, ${Number(p.params.z).toFixed(1)})`;
    case 'greet':
      return `greet ${t}`;
    case 'inquire':
      return `ask ${t} what happened`;
    case 'pledge':
      return `pledge ${p.params.discount}% off → ${t}`;
    case 'idle':
      return 'idle';
    default:
      return `${p.type} ${Object.values(p.params).join(' ')}`;
  }
}

export function fmtEvidence(id: string, memory: (id: string) => Memory | undefined, name: Namer): { text: string; kind: string } {
  const m = memory(id);
  if (m) return { text: humanize(m.summary, name), kind: m.valence >= 0 ? 'mem-pos' : 'mem-neg' };
  const [k, a, b] = id.split(':');
  switch (k) {
    case 'near': return { text: `sees ${name(a!)}`, kind: 'fact' };
    case 'inv': return { text: `stock: ${b}`, kind: 'fact' };
    case 'price': return { text: `price: ${a}`, kind: 'fact' };
    case 'quest': return { text: `quest: ${a}`, kind: 'fact' };
    case 'rel': return { text: `relationship: ${name(b!)}`, kind: 'fact' };
    case 'gold': return { text: 'purse', kind: 'fact' };
    case 'pledge': return { text: 'my pledge', kind: 'pledge' };
    case 'rewarded': return { text: 'already rewarded', kind: 'fact' };
    case 'owed': return { text: 'promise owed', kind: 'pledge' };
    default: return { text: id, kind: 'bad' };
  }
}

export const KIND_ICON: Record<string, string> = {
  rescue: '🛡',
  theft: '✋',
  gift: '🎁',
  attack: '⚔',
  promise: '🤝',
  greeting: '👋',
  trade: '⚖',
  alarm: '🔔',
  inquiry: '❓',
  promise_kept: '🤝',
  promise_broken: '💔',
};
