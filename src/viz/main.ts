import './style.css';
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { deriveContracts } from '../core/contracts';
import { groundFacts } from '../core/grounding';
import { ReliabilityLayer } from '../core/layer';
import type { Memory, Question, Trace } from '../core/types';
import { act, ELDER, GUARD, MERCHANT, NPCS, PLAYER, QUEST_CARAVAN, villageConfig } from '../game/village';
import { Character, loadModels } from './characters';
import { esc, fmtAction, humanize, KIND_ICON } from './format';
import { MindView } from './mind';
import { rogueModel, slowModel } from './models';
import { createStage } from './scene';
import { browserStorage } from './storage';

const TICK_MS = 700;
const MODEL_BUDGET_MS = 120;
const REACH = 5.5;
const LOOK: Record<string, { tint: string; color: string }> = {
  [MERCHANT]: { tint: '#e0a64b', color: '#e0a64b' },
  [GUARD]: { tint: '#6b8cff', color: '#6b8cff' },
  [ELDER]: { tint: '#9ad17a', color: '#9ad17a' },
};

type ModelMode = 'off' | 'rogue' | 'slow';

const storage = browserStorage();
const boot = ReliabilityLayer.create(villageConfig({ modelBudgetMs: MODEL_BUDGET_MS }), storage);
const layer = boot.layer;
const world = layer.world;
const name = (id: string) => world.getEntity(id)?.name ?? world.itemDef(id)?.name ?? id;

const stage = createStage(document.getElementById('stage')!, Object.fromEntries(NPCS.map((n) => [n.id, n.role])));
const models = await loadModels();
document.getElementById('loading')!.remove();

// ---------- bodies ----------
const bodies = new Map<string, Character>();
for (const n of NPCS) {
  const c = new Character(models.robot, {
    height: 1.75,
    headroom: 1.62, // the robot's head sits well above its top bone
    tint: LOOK[n.id]!.tint,
    fallbackColor: LOOK[n.id]!.color,
    loco: { idle: 'Idle', walk: 'Walking', run: 'Running' },
  });
  stage.scene.add(c.root);
  bodies.set(n.id, c);
}
const player = new Character(models.soldier, {
  height: 1.8,
  fallbackColor: '#e5e7eb',
  loco: { idle: 'Idle', walk: 'Walk', run: 'Run' },
  yaw: Math.PI,
});
stage.scene.add(player.root);

// a second traveller makes witnesses unsure who did what (proportionate autonomy)
const RIVAL = 'rook';
if (!world.getEntity(RIVAL)) world.addEntity({ id: RIVAL, kind: 'player', name: 'Rook', pos: { x: 7, z: 4 }, faction: 'travellers' });
const rival = new Character(models.soldier, { height: 1.8, fallbackColor: '#a78bfa', loco: { idle: 'Idle', walk: 'Walk', run: 'Run' }, yaw: Math.PI });
stage.scene.add(rival.root);
{
  const tag = document.createElement('div');
  tag.className = 'tag rival';
  tag.textContent = 'Rook (wanders, may steal)';
  const o = new CSS2DObject(tag);
  o.position.set(0, 2.15, 0);
  rival.root.add(o);
  const p = world.getEntity(RIVAL)!.pos;
  rival.root.position.set(p.x, 0, p.z);
}
let rivalGoal = new THREE.Vector3(7, 0, 4);
let rivalTimer = 0;
const playerTag = document.createElement('div');
playerTag.className = 'tag';
playerTag.textContent = `${name(PLAYER)} (you)`;
const playerLabel = new CSS2DObject(playerTag);
playerLabel.position.set(0, 2.15, 0);
player.root.add(playerLabel);

const posOf = (id: string): THREE.Vector3 | null => {
  if (id === PLAYER) return player.root.position.clone();
  if (id === RIVAL) return rival.root.position.clone();
  const b = bodies.get(id);
  if (b) return b.root.position.clone();
  const e = world.getEntity(id);
  return e ? new THREE.Vector3(e.pos.x, 0, e.pos.z) : null;
};
for (const e of world.entities()) {
  const body = e.id === PLAYER ? player : bodies.get(e.id);
  body?.root.position.set(e.pos.x, 0, e.pos.z);
}

// ---------- minds ----------
let selected = MERCHANT;
const minds = new Map<string, MindView>();
for (const n of NPCS) {
  minds.set(n.id, new MindView(n.id, n.role.role, bodies.get(n.id)!, stage.scene, name, stage.zones.get(n.id)!, select));
}
function select(id: string) {
  selected = id;
  for (const [k, m] of minds) m.setSelected(k === id);
  renderInspector();
}

// ---------- session ----------
const sessionEl = document.getElementById('session')!;
function renderSession() {
  const counts = NPCS.map((n) => `${name(n.id)} ${layer.memory(n.id).recall().length}`).join(' · ');
  const label = { fresh: 'New session', restored: 'Session restored', corrupt: 'Save was corrupt → fresh start' }[boot.status];
  sessionEl.className = `pill ${boot.status}`;
  sessionEl.innerHTML = `<b>${label}</b> <span>tick ${world.tick} · memories: ${counts}</span>`;
}
if (boot.status === 'restored') toast(`Welcome back. ${NPCS.map((n) => `${name(n.id)} remembers ${layer.memory(n.id).recall().length}`).join(', ')}.`);

// ---------- metrics ----------
const metrics = { decisions: 0, blocked: 0, timeouts: 0, corrected: 0, lat: [] as number[] };
function renderMetrics() {
  const lat = [...metrics.lat].sort((a, b) => a - b);
  const p95 = lat.length ? lat[Math.floor(lat.length * 0.95)]! : 0;
  document.getElementById('metrics')!.innerHTML = [
    ['decisions', metrics.decisions],
    ['blocked by boundary', metrics.blocked],
    ['model timeouts', metrics.timeouts],
    ['memories corrected', metrics.corrected],
    ['p95 decision', `${p95.toFixed(p95 < 10 ? 2 : 0)} ms`],
  ]
    .map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`)
    .join('');
}

// ---------- ticker ----------
const tickerEl = document.getElementById('ticker')!;
const lines: string[] = [];
function log(html: string) {
  lines.unshift(`<div><span class="t">t${world.tick}</span>${html}</div>`);
  lines.length = Math.min(lines.length, 6);
  tickerEl.innerHTML = lines.join('');
}

// ---------- controls ----------
let modelMode: ModelMode = 'off';
function nearestNpc(): { id: string; d: number } | null {
  const p = world.getEntity(PLAYER)!.pos;
  let best: { id: string; d: number } | null = null;
  for (const n of NPCS) {
    const e = world.getEntity(n.id)!.pos;
    const d = Math.hypot(e.x - p.x, e.z - p.z);
    if (!best || d < best.d) best = { id: n.id, d };
  }
  return best;
}

const VERBS = [
  { key: 'R', label: 'Rescue their caravan', fn: (n: string) => act.rescue(world, n), note: 'grateful memory' },
  { key: 'G', label: 'Gift bread', fn: (n: string) => act.gift(world, n, 'bread'), note: 'needs bread' },
  { key: 'P', label: 'Promise 1 bread', fn: (n: string) => act.promise(world, n, { item: 'bread', qty: 1, due: world.tick + 20 }), note: 'deliver within 20 ticks' },
  { key: 'E', label: 'Greet', fn: (n: string) => act.greet(world, n), note: 'trivial, fades' },
  { key: 'T', label: 'Steal', fn: (n: string) => act.steal(world, n, Object.keys(world.inventory(n))[0] ?? 'none'), note: 'they hold a grudge' },
  { key: 'F', label: 'Attack', fn: (n: string) => act.attack(world, n), note: 'reflex: flee / alarm' },
] as const;

const controlsEl = document.getElementById('controls')!;
controlsEl.innerHTML = `
  <h2>Player</h2>
  <p class="hint"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk · <kbd>Shift</kbd> run · drag to orbit</p>
  <div id="near" class="near"></div>
  <div class="verbs">${VERBS.map((v) => `<button data-verb="${v.key}"><kbd>${v.key}</kbd>${v.label}<small>${v.note}</small></button>`).join('')}</div>
  <div id="inv" class="inv"></div>

  <h2>Game master <small>authoritative engine</small></h2>
  <div class="gm">
    <button id="retract" title="The game decides the last player event never happened (e.g. false accusation)">↩ Retract last event</button>
    <button id="forge" title="Write a memory that cites evidence the game never produced">☠ Inject false memory</button>
    <button id="rookSteal" title="Rook steals from Mira wherever he stands; distant witnesses may not be sure who it was">🥷 Rook steals from Mira</button>
  </div>

  <h2>Model tier <small>budget ${MODEL_BUDGET_MS} ms</small></h2>
  <div class="seg" id="model">
    <button data-mode="off" class="on">Utility only</button>
    <button data-mode="rogue">Rogue model</button>
    <button data-mode="slow">Network down</button>
  </div>
  <p class="hint" id="modelHint">Deterministic utility scoring over the designer's action catalog.</p>

  <h2>Session <small>cross-session memory</small></h2>
  <div class="gm">
    <button id="reload" class="primary">⟳ End session &amp; reload</button>
    <button id="wipe">Wipe save</button>
  </div>`;

controlsEl.querySelectorAll<HTMLButtonElement>('[data-verb]').forEach((b) =>
  b.addEventListener('click', () => doVerb(b.dataset.verb!)),
);
function doVerb(key: string) {
  const v = VERBS.find((x) => x.key === key);
  const near = nearestNpc();
  if (!v || !near) return;
  if (near.d > REACH) return toast(`Walk closer to someone first (nearest: ${name(near.id)}, ${near.d.toFixed(1)} m).`);
  const ev = v.fn(near.id);
  if (!ev) return toast(key === 'G' ? 'You have no bread left.' : `${name(near.id)} has nothing to take.`);
  player.root.lookAt(posOf(near.id)!.setY(0));
  const phrase = { rescue: 'rescued the caravan of', gift: 'gave bread to', promise: 'made a promise to', greeting: 'greeted', theft: `stole ${ev.data?.item ?? ''} from`, attack: 'attacked' }[ev.type as string] ?? ev.type;
  log(`<b>${esc(name(PLAYER))}</b> ${esc(phrase)} <b>${esc(name(near.id))}</b> <span class="dim">${ev.id}</span>`);
}

document.getElementById('retract')!.addEventListener('click', () => {
  const ev = [...world.events()].reverse().find((e) => e.actor === PLAYER && !e.retracted);
  if (!ev) return toast('No player event to retract.');
  world.retract(ev.id);
  log(`<span class="gmtag">GM</span> retracted ${ev.id} (${ev.type} → ${esc(name(ev.target))}). Memories citing it will be corrected.`);
});
document.getElementById('rookSteal')!.addEventListener('click', () => {
  const item = Object.keys(world.inventory(MERCHANT))[0];
  if (!item || !world.transfer(MERCHANT, RIVAL, item)) return toast('Mira has nothing left to steal.');
  const ev = world.emit({ type: 'theft', actor: RIVAL, target: MERCHANT, pos: { ...world.getEntity(RIVAL)!.pos }, data: { item } });
  const seen = Object.entries(ev.witnesses ?? {}).map(([id, w]) => `${name(id)} saw ${name(w.actor)} (${Math.round(w.confidence * 100)}%)`).join(', ');
  log(`<span class="gmtag">rook</span> Rook stole ${esc(item)} from Mira. ${esc(seen)}`);
});
document.getElementById('forge')!.addEventListener('click', () => {
  const m = layer.memory(selected).inject({ kind: 'attack', subject: PLAYER, tick: world.tick, summary: 'player attacked me', evidence: ['ev-forged'] });
  log(`<span class="gmtag bad">corrupt</span> injected “${esc(humanize(m.summary, name))}” into ${esc(name(selected))} citing <code>ev-forged</code>`);
  minds.get(selected)!.apply(lastTrace.get(selected) ?? blankTrace(selected), layer.memory(selected), posOf, () => null, world.relationship(selected, PLAYER), commitmentsOf(selected));
});
document.getElementById('model')!.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b) return;
  modelMode = b.dataset.mode as ModelMode;
  layer.setModel(modelMode === 'rogue' ? rogueModel() : modelMode === 'slow' ? slowModel() : undefined);
  document.querySelectorAll('#model button').forEach((x) => x.classList.toggle('on', x === b));
  document.getElementById('modelHint')!.textContent = {
    off: "Deterministic utility scoring over the designer's action catalog.",
    rogue: 'A model that invents items, completes quests, wanders off and cites fake evidence. Watch the boundary block it.',
    slow: 'Model never answers within budget. NPCs fall back to utility without stalling.',
  }[modelMode];
});
document.getElementById('reload')!.addEventListener('click', () => {
  layer.save();
  location.reload();
});
document.getElementById('wipe')!.addEventListener('click', () => {
  layer.clearSave();
  wiped = true;
  location.reload();
});
let wiped = false;
addEventListener('beforeunload', () => !wiped && layer.save());

// ---------- inspector ----------
const inspectorEl = document.getElementById('inspector')!;
const lastTrace = new Map<string, Trace>();
let question: Question = { type: 'remember', subject: PLAYER };
let lastAnswer = '';

function renderInspector() {
  const cfg = layer.config(selected);
  const mem = layer.memory(selected);
  const t = lastTrace.get(selected);
  const facts = [...groundFacts(world, selected, cfg.knowledge).values()];
  const hist = layer.traces(selected).slice(-10).reverse();
  const maxScore = Math.max(1, ...(t?.candidates.map((c) => c.score) ?? [1]));

  inspectorEl.innerHTML = `
    <div class="ihd"><div><h2>${esc(name(selected))}</h2><span class="role">${esc(cfg.role.role)}</span></div>
      <div class="tabs">${NPCS.map((n) => `<button data-sel="${n.id}" class="${n.id === selected ? 'on' : ''}">${esc(name(n.id))}</button>`).join('')}</div></div>

    <h3>Designer controls</h3>
    <div class="allowed">${cfg.role.allowed.map((a) => `<span>${a}</span>`).join('')}</div>
    <p class="hint">zone r=${cfg.role.zone.radius} · max discount ${cfg.role.maxDiscount}% · relationship ±${cfg.role.maxRelationshipDelta}/action · remembers: ${Object.keys(cfg.memory.rules).join(', ')}</p>

    <h3>Why this action <small>tick ${t?.tick ?? '–'} · ${t ? t.latencyMs.toFixed(2) : '–'} ms</small></h3>
    <ul class="cands">${(t?.candidates ?? [])
      .map(
        (c) => `<li class="${c.type === t?.executed.type ? 'chosen' : ''}"><span>${c.type}</span><i style="width:${(c.score / maxScore) * 100}%"></i><b>${c.score.toFixed(2)}</b></li>`,
      )
      .join('')}</ul>
    ${(t?.rejected ?? []).map((r) => `<div class="blocked">⛔ ${esc(r.proposal.tier)}: ${esc(fmtAction(r.proposal, name))}<br><small>${r.issues.map(esc).join('<br>')}</small></div>`).join('')}

    <h3>Memory ledger <small>${mem.all().length}/${cfg.memory.capacity}</small></h3>
    <ul class="ledger">${
      mem
        .all()
        .sort((a, b) => b.tick - a.tick)
        .map(
          (m: Memory) => `<li class="${m.status}">
            <span class="ic">${KIND_ICON[m.kind] ?? '•'}</span>
            <div><div>${esc(humanize(m.summary, name))}</div>
              <small>${m.id} · t${m.tick} · cites ${m.evidence.join(', ')}${m.correctionReason ? ` · <em>${esc(m.correctionReason)}</em>` : ''}</small></div>
            <span class="sal"><i style="width:${Math.round(m.salience * 100)}%"></i></span>
            <button data-forget="${m.id}" title="Forget this memory">forget</button></li>`,
        )
        .join('') || '<li class="empty">Nothing remembered yet.</li>'
    }</ul>

    <h3>Grounded facts <small>from game state</small></h3>
    <div class="facts">${facts.map((f) => `<span title="${esc(f.id)}">${esc(f.id.replace(/^(\w+):.*?([^:]+)$/, '$1 $2'))} = <b>${esc(String(f.value))}</b></span>`).join('')}</div>

    <h3>Ask ${esc(name(selected))}</h3>
    <div class="ask">
      <select id="q">
        <option value="remember">What do you remember about me?</option>
        <option value="has_item:potion">Do you have potions?</option>
        <option value="has_item:sword">Do you have a sword?</option>
        <option value="has_item:excalibur">Do you have Excalibur?</option>
        <option value="price:potion">What does a potion cost?</option>
        <option value="quest_status:${QUEST_CARAVAN}">Is the caravan quest open?</option>
      </select><button id="askBtn">Ask</button>
    </div>
    <div class="answer">${lastAnswer}</div>

    <h3>Trace timeline</h3>
    <ul class="timeline">${hist
      .map(
        (h) => `<li><span class="t">t${h.tick}</span><span class="tier ${h.executed.tier}">${h.executed.tier}</span><span>${esc(fmtAction(h.executed, name))}</span><span class="${h.verdict.ok ? 'ok' : 'bad'}">${h.verdict.ok ? '✓' : '✗'}</span></li>`,
      )
      .join('')}</ul>`;

  inspectorEl.querySelectorAll<HTMLButtonElement>('[data-sel]').forEach((b) => b.addEventListener('click', () => select(b.dataset.sel!)));
  inspectorEl.querySelectorAll<HTMLButtonElement>('[data-forget]').forEach((b) =>
    b.addEventListener('click', () => {
      layer.forget(selected, b.dataset.forget!);
      log(`<span class="gmtag">forget</span> ${esc(name(selected))} forgot ${b.dataset.forget}`);
      renderInspector();
    }),
  );
  const sel = inspectorEl.querySelector<HTMLSelectElement>('#q')!;
  sel.value = question.type === 'remember' ? 'remember' : `${question.type}:${'item' in question ? question.item : 'quest' in question ? question.quest : ''}`;
  inspectorEl.querySelector('#askBtn')!.addEventListener('click', () => {
    const [type, arg] = sel.value.split(':');
    question =
      type === 'remember'
        ? { type: 'remember', subject: PLAYER }
        : type === 'quest_status'
          ? { type: 'quest_status', quest: arg! }
          : { type: type as 'has_item' | 'price', item: arg! };
    const a = layer.ask(selected, question);
    lastAnswer = `<p class="${a.known ? '' : 'unknown'}">“${esc(humanize(a.text, name))}”</p><small>${a.citations.length ? `cites ${a.citations.map(esc).join(', ')}` : 'no citation → says it does not know'}</small>`;
    renderInspector();
  });
}

function blankTrace(id: string): Trace {
  const idle = { npcId: id, type: 'idle', params: {}, evidence: [], rationale: 'waking up', tier: 'utility' as const };
  return {
    tick: world.tick, npcId: id, focus: null, newMemories: [], corrected: [], forgotten: [], recalled: [],
    candidates: [], proposal: idle, executed: idle, verdict: { grounded: true, permitted: true, consistent: true, proportionate: true, ok: true, issues: [] },
    violations: [], effects: [], latencyMs: 0,
  };
}

// ---------- tick ----------
/** Promises owed to and pledges made by this NPC, straight from the event log. */
function commitmentsOf(npc: string): { text: string; cls: string }[] {
  const out: { text: string; cls: string }[] = [];
  const all = deriveContracts(world);
  for (const c of all) {
    if (c.kind === 'promise' && c.creditor === npc) {
      const who = name(c.debtor);
      if (c.status === 'open') out.push({ text: `📜 ${who} owes ${c.qty} ${c.item}: ${c.due - world.tick} ticks left`, cls: 'open' });
      else if (world.tick - c.due < 40 || c.status === 'kept')
        out.push({ text: c.status === 'kept' ? `🤝 ${who} kept their promise` : `💔 ${who} broke their promise`, cls: c.status });
    }
    if (c.kind === 'pledge' && c.debtor === npc && c.status === 'open')
      out.push({ text: `🔏 I pledged ${c.discount}% off ${name(c.creditor)}'s next trade`, cls: 'pledge' });
  }
  return out.slice(-3);
}

const EMOTE: Record<string, string> = {
  greet: 'Wave',
  offer_trade: 'ThumbsUp',
  refuse_trade: 'No',
  offer_quest: 'Yes',
  call_guard: 'Punch',
  inquire: 'Wave',
  pledge: 'ThumbsUp',
};
const lastEmote = new Map<string, { key: string; tick: number }>();
let ticking = false;

async function step() {
  if (ticking) return;
  ticking = true;
  try {
    const traces = await layer.tick();
    for (const t of traces) {
      lastTrace.set(t.npcId, t);
      metrics.decisions++;
      metrics.lat.push(t.latencyMs);
      if (metrics.lat.length > 300) metrics.lat.shift();
      if (t.rejected?.length) metrics.blocked += t.rejected.length;
      if (t.fallbackReason === 'timeout') metrics.timeouts++;
      metrics.corrected += t.corrected.length;

      const mem = layer.memory(t.npcId);
      minds.get(t.npcId)!.apply(t, mem, posOf, (m) => originOf(m), world.relationship(t.npcId, PLAYER), commitmentsOf(t.npcId));
      const body = bodies.get(t.npcId)!;
      body.lookAt = t.focus ? posOf(t.focus) : null;

      const type = t.executed.type;
      const gesture = type === 'adjust_relationship' ? (Number(t.executed.params.delta) > 0 ? 'Yes' : 'No') : EMOTE[type];
      const key = `${type}|${t.executed.params.target ?? ''}|${t.executed.params.discount ?? ''}`;
      const prev = lastEmote.get(t.npcId);
      if (gesture && (!prev || prev.key !== key || t.tick - prev.tick > 8)) {
        body.play(gesture);
        lastEmote.set(t.npcId, { key, tick: t.tick });
      }

      for (const id of t.newMemories) {
        const m = mem.get(id);
        if (m) log(`<b>${esc(name(t.npcId))}</b> remembers <span class="${m.valence >= 0 ? 'pos' : 'neg'}">${esc(humanize(m.summary, name))}</span>`);
      }
      for (const id of t.corrected) log(`<b>${esc(name(t.npcId))}</b> <span class="neg">corrected</span> ${id}: ${esc(mem.get(id)?.correctionReason ?? '')}`);
      for (const r of t.rejected ?? []) log(`<span class="gmtag bad">blocked</span> ${esc(name(t.npcId))}'s ${r.proposal.tier}: ${esc(fmtAction(r.proposal, name))} <span class="dim">${esc(r.issues[0] ?? '')}</span>`);
      if (type !== 'idle' && type !== 'move_to' && (!prev || prev.key !== key)) log(`<b>${esc(name(t.npcId))}</b> → ${esc(fmtAction(t.executed, name))}`);
    }
    if (world.tick % 10 === 0) layer.save();
    renderMetrics();
    renderSession();
    if (!inspectorEl.contains(document.activeElement)) renderInspector();
  } finally {
    ticking = false;
  }
}

function originOf(m: Memory): THREE.Vector3 | null {
  const ev = world.eventById(m.evidence[0] ?? '');
  if (!ev) return null;
  const actorPos = posOf(ev.actor);
  return (actorPos ?? new THREE.Vector3(ev.pos.x, 0, ev.pos.z)).setY(1.2);
}

// ---------- input & loop ----------
const keys = new Set<string>();
addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'SELECT') return;
  const k = e.key.toLowerCase();
  keys.add(k);
  const verb = VERBS.find((v) => v.key.toLowerCase() === k);
  if (verb && !['w', 'a', 's', 'd'].includes(k)) doVerb(verb.key);
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

const raycaster = new THREE.Raycaster();
stage.renderer.domElement.addEventListener('pointerup', (e) => {
  const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, stage.camera);
  for (const [id, b] of bodies) if (raycaster.intersectObjects(b.meshes, false).length) return select(id);
});

const timer = new THREE.Timer();
let acc = 0;
const fwd = new THREE.Vector3();
const right = new THREE.Vector3();

function frame() {
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.1);

  // player: camera-relative WASD, authoritative position goes through the engine
  stage.camera.getWorldDirection(fwd).setY(0).normalize();
  right.crossVectors(fwd, new THREE.Vector3(0, 1, 0));
  const move = new THREE.Vector3();
  if (keys.has('w') || keys.has('arrowup')) move.add(fwd);
  if (keys.has('s') || keys.has('arrowdown')) move.sub(fwd);
  if (keys.has('d') || keys.has('arrowright')) move.add(right);
  if (keys.has('a') || keys.has('arrowleft')) move.sub(right);
  const speed = move.lengthSq() ? (keys.has('shift') ? 7 : 3.4) : 0;
  if (speed) {
    move.normalize();
    const p = player.root.position.addScaledVector(move, speed * dt);
    p.setLength(Math.min(p.length(), 34));
    act.moveTo(world, { x: p.x, z: p.z });
    stage.controls.target.lerp(new THREE.Vector3(p.x * 0.6, 1, p.z * 0.6 + 1), 1 - Math.exp(-2 * dt));
  }
  player.drive(dt, speed, speed ? Math.atan2(move.x, move.z) : null);

  // Rook drifts around the square, sometimes right next to the player
  rivalTimer -= dt;
  if (rivalTimer <= 0) {
    rivalTimer = 3 + Math.random() * 4;
    const p = player.root.position;
    rivalGoal = Math.random() < 0.35
      ? new THREE.Vector3(p.x + (Math.random() - 0.5) * 2.4, 0, p.z + (Math.random() - 0.5) * 2.4)
      : new THREE.Vector3(2 + Math.random() * 8, 0, -1 + Math.random() * 7);
  }
  {
    const r = rival.root.position;
    const d = rivalGoal.clone().sub(r);
    const step = Math.min(d.length(), 1.6 * dt);
    if (step > 0.01) r.addScaledVector(d.normalize(), step);
    rival.drive(dt, step > 0.01 ? 1.6 : 0, step > 0.01 ? Math.atan2(d.x, d.z) : null);
    world.moveEntity(RIVAL, { x: r.x, z: r.z });
  }

  for (const [id, b] of bodies) {
    const e = world.getEntity(id)!;
    b.update(dt, new THREE.Vector3(e.pos.x, 0, e.pos.z));
    const mind = minds.get(id)!;
    mind.frame(dt);
    mind.setCompact(id !== selected && b.root.position.distanceTo(player.root.position) > 7);
  }

  const near = nearestNpc();
  const nearEl = document.getElementById('near')!;
  const inReach = !!near && near.d <= REACH;
  nearEl.innerHTML = near
    ? `${inReach ? 'Facing' : 'Nearest'} <b>${esc(name(near.id))}</b> · ${near.d.toFixed(1)} m ${inReach ? '' : '<span class="dim">(walk closer)</span>'}`
    : '';
  controlsEl.querySelectorAll<HTMLButtonElement>('[data-verb]').forEach((b) => (b.disabled = !inReach));
  document.getElementById('inv')!.textContent = `Your pack: ${Object.entries(world.inventory(PLAYER)).map(([k, v]) => `${name(k)} ×${v}`).join(', ') || 'empty'}`;

  acc += dt * 1000;
  if (acc >= TICK_MS) {
    acc = 0;
    void step();
  }

  stage.controls.update();
  stage.render();
  requestAnimationFrame(frame);
}

// first paint from restored state, then go
for (const n of NPCS) minds.get(n.id)!.apply(blankTrace(n.id), layer.memory(n.id), posOf, () => null, world.relationship(n.id, PLAYER), commitmentsOf(n.id));
select(MERCHANT);
renderSession();
renderMetrics();
log(boot.status === 'restored' ? 'Session restored from save. NPC memories reloaded and re-verified against the game.' : 'New session. Walk up to Mira (the merchant) and do something memorable.');
requestAnimationFrame(frame);

function toast(msg: string) {
  const el = document.getElementById('toast')!;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout((toast as unknown as { t?: number }).t);
  (toast as unknown as { t?: number }).t = window.setTimeout(() => el.classList.remove('show'), 3200);
}

if (import.meta.env.DEV) Object.assign(window, { __npc: { layer, bodies, player, rival, stage, THREE, holdRival: () => (rivalTimer = 1e9) } });
