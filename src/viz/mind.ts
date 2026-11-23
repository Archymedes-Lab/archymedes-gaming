// The NPC's mind made visible: a panel above the head (memory, decision, evidence, verdict),
// memory orbs orbiting the head, and evidence beams to whatever a decision cites.
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { MemoryStore } from '../core/memory';
import type { Memory, Trace } from '../core/types';
import type { Character } from './characters';
import { esc, fmtAction, fmtEvidence, humanize, KIND_ICON, type Namer } from './format';

interface Orb {
  mesh: THREE.Mesh;
  halo: THREE.Mesh;
  memory: Memory;
  phase: number;
  born: number;
  from: THREE.Vector3 | null;
  dying: number | null;
}

interface Beam {
  line: THREE.Line;
  to: () => THREE.Vector3 | null;
}

const POS = new THREE.Color('#5eead4');
const NEG = new THREE.Color('#fb7185');
const NEUTRAL = new THREE.Color('#fbbf24');
const DEAD = new THREE.Color('#64748b');
const orbGeo = new THREE.SphereGeometry(1, 16, 12);

export class MindView {
  readonly el = document.createElement('div');
  private label: CSS2DObject;
  private orbs = new Map<string, Orb>();
  private beams: Beam[] = [];
  private beamAge = 0;
  private group = new THREE.Group();
  private alarm = 0;
  private time = 0;

  constructor(
    readonly npcId: string,
    private role: string,
    private character: Character,
    private scene: THREE.Scene,
    private name: Namer,
    private zone: THREE.Mesh,
    onSelect: (id: string) => void,
  ) {
    this.el.className = 'mind';
    this.el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      onSelect(npcId);
    });
    this.label = new CSS2DObject(this.el);
    this.label.center.set(0.5, 1);
    this.label.position.set(0, character.height + 1.35, 0);
    character.root.add(this.label);
    scene.add(this.group);
  }

  private head(): THREE.Vector3 {
    return this.character.root.position.clone().setY(this.character.height + 0.45);
  }

  setSelected(on: boolean) {
    this.el.classList.toggle('selected', on);
  }

  /** Distant, unselected minds collapse to a summary so panels do not crowd the view. */
  setCompact(on: boolean) {
    this.el.classList.toggle('compact', on);
  }

  /** Sync with a trace. `origin` gives where a new memory came from (the event location). */
  apply(
    trace: Trace,
    memory: MemoryStore,
    positionOf: (id: string) => THREE.Vector3 | null,
    origin: (m: Memory) => THREE.Vector3 | null,
    relationship: number,
    commitments: { text: string; cls: string }[] = [],
  ) {
    // orbs: one per stored memory
    const live = new Set<string>();
    for (const m of memory.all()) {
      live.add(m.id);
      const existing = this.orbs.get(m.id);
      if (!existing) this.spawnOrb(m, trace.newMemories.includes(m.id) ? origin(m) : null);
      else existing.memory = m;
      if (m.status === 'corrected') this.killOrb(m.id);
    }
    for (const id of this.orbs.keys()) if (!live.has(id)) this.killOrb(id);

    // beams: evidence the executed action cites
    for (const b of this.beams) this.group.remove(b.line);
    this.beams = [];
    for (const ev of trace.executed.evidence) {
      const orb = this.orbs.get(ev);
      if (orb) this.addBeam(() => orb.mesh.position.clone(), orb.memory.valence >= 0 ? POS : NEG);
      else if (ev.startsWith('near:')) this.addBeam(() => positionOf(ev.slice(5))?.setY(1.3) ?? null, new THREE.Color('#93c5fd'));
    }
    this.beamAge = 0;
    if (trace.rejected?.length || trace.violations.length) this.alarm = 1;

    this.el.innerHTML = this.panel(trace, memory, relationship, commitments);
  }

  private addBeam(to: () => THREE.Vector3 | null, color: THREE.Color) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const mat = new THREE.LineDashedMaterial({ color, dashSize: 0.18, gapSize: 0.1, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    this.group.add(line);
    this.beams.push({ line, to });
  }

  private spawnOrb(m: Memory, from: THREE.Vector3 | null) {
    const color = m.valence > 0.05 ? POS : m.valence < -0.05 ? NEG : NEUTRAL;
    const mesh = new THREE.Mesh(orbGeo, new THREE.MeshBasicMaterial({ color, transparent: true }));
    const halo = new THREE.Mesh(
      orbGeo,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    mesh.add(halo);
    halo.scale.setScalar(2.2);
    const n = this.orbs.size;
    this.orbs.set(m.id, { mesh, halo, memory: m, phase: n * 2.399, born: this.time, from, dying: null });
    mesh.position.copy(from ?? this.head());
    this.group.add(mesh);
  }

  private killOrb(id: string) {
    const o = this.orbs.get(id);
    if (o && o.dying === null) {
      o.dying = this.time;
      (o.mesh.material as THREE.MeshBasicMaterial).color.copy(DEAD);
      (o.halo.material as THREE.MeshBasicMaterial).color.copy(DEAD);
    }
  }

  frame(dt: number) {
    this.time += dt;
    const head = this.head();
    const active = [...this.orbs.values()].filter((o) => o.dying === null);
    const ring = 0.75 + Math.min(active.length, 12) * 0.045;
    for (const [id, o] of this.orbs) {
      const a = o.phase + this.time * 0.7;
      const slot = new THREE.Vector3(Math.cos(a) * ring, 0.05 * Math.sin(this.time * 2 + o.phase), Math.sin(a) * ring).add(head);
      const age = this.time - o.born;
      if (o.from && age < 1) {
        // newly formed memory flies from where the event happened into the head
        const t = easeOut(age);
        o.mesh.position.lerpVectors(o.from, slot, t).setY(THREE.MathUtils.lerp(o.from.y, slot.y, t) + Math.sin(t * Math.PI) * 1.2);
      } else o.mesh.position.copy(slot);
      const size = 0.08 + 0.12 * o.memory.salience;
      if (o.dying !== null) {
        const k = 1 - (this.time - o.dying) / 1.4;
        if (k <= 0) {
          this.group.remove(o.mesh);
          this.orbs.delete(id);
          continue;
        }
        o.mesh.scale.setScalar(size * k);
        o.mesh.position.y += (1 - k) * 0.8;
      } else o.mesh.scale.setScalar(size * (age < 0.3 ? age / 0.3 : 1) * (1 + 0.08 * Math.sin(this.time * 3 + o.phase)));
    }

    this.beamAge += dt;
    for (const b of this.beams) {
      const to = b.to();
      const mat = b.line.material as THREE.LineDashedMaterial;
      if (!to) {
        mat.opacity = 0;
        continue;
      }
      b.line.geometry.setFromPoints([head, to]);
      b.line.computeLineDistances();
      mat.opacity = Math.max(0.2, 0.95 - this.beamAge * 0.6);
    }

    // zone ring pulses red when the boundary blocks something
    this.alarm = Math.max(0, this.alarm - dt * 0.8);
    const zm = this.zone.material as THREE.MeshBasicMaterial;
    zm.color.setRGB(0.43 + 0.55 * this.alarm, 0.66 - 0.4 * this.alarm, 1 - 0.6 * this.alarm);
    zm.opacity = 0.35 + 0.5 * this.alarm;
  }

  private panel(t: Trace, memory: MemoryStore, rel: number, commitments: { text: string; cls: string }[]): string {
    const n = this.name;
    const mems = memory.recall();
    const corrected = memory.all().filter((m) => m.status === 'corrected' && t.corrected.includes(m.id));
    const memRows = mems
      .slice(0, 3)
      .map(
        (m) => `<li class="${m.valence >= 0 ? 'pos' : 'neg'}${t.newMemories.includes(m.id) ? ' new' : ''}">
          <span class="ic">${KIND_ICON[m.kind] ?? '•'}</span>
          <span class="txt">${esc(humanize(m.summary, n))}${m.confidence < 1 ? ` <em class="conf">${Math.round(m.confidence * 100)}% sure</em>` : ''}</span>
          <span class="sal"><i style="width:${Math.round(m.salience * 100)}%"></i></span></li>`,
      )
      .join('');
    const more = mems.length > 3 ? `<li class="more">+${mems.length - 3} more</li>` : '';
    const fixed = corrected
      .map((m) => `<li class="fixed"><span class="ic">✕</span><span class="txt">${esc(humanize(m.summary, n))}</span><span class="why">corrected</span></li>`)
      .join('');
    const forgot = t.forgotten.length ? `<li class="more">faded: ${t.forgotten.length} trivial memor${t.forgotten.length > 1 ? 'ies' : 'y'}</li>` : '';

    const chips = t.executed.evidence
      .map((id) => {
        const e = fmtEvidence(id, (x) => memory.get(x), n);
        return `<span class="chip ${e.kind}">${esc(e.text)}</span>`;
      })
      .join('');
    const v = t.verdict;
    const check = (ok: boolean, label: string) => `<span class="${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'} ${label}</span>`;
    const rej = (t.rejected ?? [])
      .slice(0, 1)
      .map(
        (r) => `<div class="blocked">⛔ blocked ${esc(r.proposal.tier)}: <b>${esc(fmtAction(r.proposal, n))}</b>
          <small>${esc((r.issues[0] ?? 'rejected').replace(/^(\w+):/, '$1 —'))}</small></div>`,
      )
      .join('');
    const unsure = t.executed.type === 'inquire'
      ? `<div class="probe">⚖ not sure enough for an irreversible act → probing first</div>` : '';
    const deals = commitments.length
      ? `<div class="sec">commitments</div><ul class="deals">${commitments.map((c) => `<li class="${c.cls}">${esc(c.text)}</li>`).join('')}</ul>` : '';
    const timeout = t.fallbackReason === 'timeout' ? `<div class="timeout">⏱ model over latency budget → fell back to utility</div>` : '';
    const relPct = (rel + 100) / 2;

    return `
      <div class="hd">
        <div><b>${esc(n(this.npcId))}</b> <span class="role">${esc(this.role)}</span></div>
        <span class="tier ${t.executed.tier}">${t.executed.tier}</span>
      </div>
      <div class="rel" title="relationship with ${esc(n('player'))}: ${rel}"><span>♥ ${rel > 0 ? '+' : ''}${rel}</span><div class="bar"><i style="left:${Math.min(relPct, 50)}%;width:${Math.abs(relPct - 50)}%" class="${rel >= 0 ? 'p' : 'n'}"></i></div></div>
      <div class="sec">memory <span class="count">${mems.length}</span></div>
      <ul class="mem">${memRows || '<li class="empty">no memories yet</li>'}${more}${fixed}${forgot}</ul>
      <div class="sec">decision</div>
      <div class="act">→ ${esc(fmtAction(t.executed, n))}</div>
      <div class="why">${esc(humanize(t.executed.rationale, n))}</div>
      ${chips ? `<div class="chips">${chips}</div>` : ''}
      ${unsure}
      <div class="verdict">${check(v.grounded, 'grounded')}${check(v.permitted, 'permitted')}${check(v.consistent, 'consistent')}${check(v.proportionate, 'proportionate')}</div>
      ${deals}${rej}${timeout}`;
  }
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
