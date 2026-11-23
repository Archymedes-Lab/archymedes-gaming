import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

export interface Models {
  robot: GLTF | null;
  soldier: GLTF | null;
}

export async function loadModels(): Promise<Models> {
  const loader = new GLTFLoader();
  const load = (url: string) => loader.loadAsync(url).catch((e) => (console.warn('model failed', url, e), null));
  const [robot, soldier] = await Promise.all([load('/models/RobotExpressive.glb'), load('/models/Soldier.glb')]);
  return { robot, soldier };
}

interface Locomotion {
  idle: string;
  walk: string;
  run: string;
}

/** An animated body whose displayed position eases toward the authoritative game position. */
export class Character {
  readonly root = new THREE.Group();
  readonly height: number;
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private base: THREE.AnimationAction | null = null;
  private emote: THREE.AnimationAction | null = null;
  private heading = 0;
  lookAt: THREE.Vector3 | null = null;

  constructor(
    gltf: GLTF | null,
    opts: { height: number; tint?: string; loco: Locomotion; fallbackColor: string; yaw?: number; headroom?: number },
    private loco: Locomotion = opts.loco,
  ) {
    this.height = opts.height;
    if (gltf) {
      const model = SkeletonUtils.clone(gltf.scene) as THREE.Object3D;
      // Box3 on skinned meshes measures unskinned local geometry; the skeleton is reliable.
      model.updateMatrixWorld(true);
      let top = 0;
      const v = new THREE.Vector3();
      model.traverse((o) => {
        if ((o as THREE.Bone).isBone) top = Math.max(top, o.getWorldPosition(v).y);
      });
      model.scale.setScalar(top > 0 ? opts.height / (top * (opts.headroom ?? 1.1)) : 1);
      if (opts.yaw) model.rotation.y = opts.yaw;
      model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        if (opts.tint) {
          const swap = (m: THREE.Material) => {
            if (m.name !== 'Main') return m;
            const c = (m as THREE.MeshStandardMaterial).clone();
            c.color = new THREE.Color(opts.tint);
            return c;
          };
          mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
        }
      });
      this.root.add(model);
      this.mixer = new THREE.AnimationMixer(model);
      for (const clip of gltf.animations) this.actions.set(clip.name, this.mixer.clipAction(clip));
      this.mixer.addEventListener('finished', () => this.endEmote());
      this.setBase(this.loco.idle);
    } else {
      const body = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.35, opts.height - 0.7, 6, 12),
        new THREE.MeshStandardMaterial({ color: opts.fallbackColor }),
      );
      body.position.y = opts.height / 2;
      body.castShadow = true;
      this.root.add(body);
    }
  }

  private setBase(name: string) {
    const next = this.actions.get(name);
    if (!next || next === this.base) return;
    if (this.emote) {
      // gesture in progress: swap the underlying loop silently, it fades in when the gesture ends
      this.base?.stop();
      next.reset().play().stopFading().setEffectiveWeight(0);
    } else {
      next.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.25).play();
      this.base?.fadeOut(0.25);
    }
    this.base = next;
  }

  /** Plays a one-shot gesture, then returns to locomotion. */
  play(name: string) {
    const a = this.actions.get(name);
    if (!a) return;
    if (this.emote) this.emote.fadeOut(0.15);
    a.reset().setLoop(THREE.LoopOnce, 1).fadeIn(0.15).play();
    a.clampWhenFinished = true;
    this.base?.fadeOut(0.15);
    this.emote = a;
  }

  private endEmote() {
    if (!this.emote) return;
    this.emote.fadeOut(0.3);
    this.emote = null;
    this.base?.setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.3).play();
  }

  /** Eases toward target; returns the speed used this frame. */
  update(dt: number, target: THREE.Vector3, snap = false): number {
    const p = this.root.position;
    const d = target.clone().sub(p).setY(0);
    const dist = d.length();
    let speed = 0;
    if (snap || dist > 25) p.copy(target);
    else if (dist > 0.02) {
      speed = dist > 2.5 ? 7 : dist > 0.6 ? 3.2 : 1.6;
      p.addScaledVector(d.normalize(), Math.min(dist, speed * dt));
      this.heading = Math.atan2(d.x, d.z);
    } else if (this.lookAt) {
      const l = this.lookAt.clone().sub(p);
      if (l.lengthSq() > 0.01) this.heading = Math.atan2(l.x, l.z);
    }
    this.root.rotation.y = dampAngle(this.root.rotation.y, this.heading, 10, dt);
    this.setBase(speed > 4 ? this.loco.run : speed > 0 ? this.loco.walk : this.loco.idle);
    this.mixer?.update(dt);
    return speed;
  }

  /** Drives the body directly (player); speed picks the animation. */
  drive(dt: number, speed: number, heading: number | null) {
    if (heading !== null) this.heading = heading;
    this.root.rotation.y = dampAngle(this.root.rotation.y, this.heading, 12, dt);
    this.setBase(speed > 5 ? this.loco.run : speed > 0.1 ? this.loco.walk : this.loco.idle);
    this.mixer?.update(dt);
  }

  get meshes(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    this.root.traverse((o) => (o as THREE.Mesh).isMesh && out.push(o));
    return out;
  }
}

function dampAngle(from: number, to: number, lambda: number, dt: number) {
  let diff = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return from + diff * (1 - Math.exp(-lambda * dt));
}
