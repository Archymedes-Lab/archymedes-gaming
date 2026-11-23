import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { RoleSpec } from '../core/types';

export interface Stage {
  renderer: THREE.WebGLRenderer;
  labels: CSS2DRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  ground: THREE.Mesh;
  zones: Map<string, THREE.Mesh>;
  render(): void;
}

export function createStage(container: HTMLElement, roles: Record<string, RoleSpec>): Stage {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  const labels = new CSS2DRenderer();
  labels.setSize(innerWidth, innerHeight);
  labels.domElement.className = 'labels';
  container.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0b1020');
  scene.fog = new THREE.Fog('#0b1020', 38, 85);

  const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 200);
  camera.position.set(1, 23, 29);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(1, 0, 1.5);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.46;
  controls.minDistance = 8;
  controls.maxDistance = 60;

  // light: dusk sky + low warm sun + lanterns
  scene.add(new THREE.HemisphereLight('#a9bfff', '#2b2015', 0.9));
  const sun = new THREE.DirectionalLight('#ffd9a8', 2.2);
  sun.position.set(-18, 26, 14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30 });
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(60, 96),
    new THREE.MeshStandardMaterial({ color: '#1d2b22', roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.name = 'ground';
  scene.add(ground);

  const path = new THREE.Mesh(
    new THREE.PlaneGeometry(34, 3.2),
    new THREE.MeshStandardMaterial({ color: '#3a3328', roughness: 1 }),
  );
  path.rotation.x = -Math.PI / 2;
  path.position.set(1, 0.01, 3.2);
  path.receiveShadow = true;
  scene.add(path);

  buildMarket(scene, new THREE.Vector3(0, 0, -1.6));
  buildGuardPost(scene, new THREE.Vector3(12, 0, -2));
  buildHut(scene, new THREE.Vector3(-11.5, 0, 3.6));
  buildTrees(scene);

  const zones = new Map<string, THREE.Mesh>();
  for (const [id, role] of Object.entries(roles)) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(role.zone.radius - 0.06, role.zone.radius, 96),
      new THREE.MeshBasicMaterial({ color: '#6ea8ff', transparent: true, opacity: 0.35, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(role.zone.center.x, 0.03, role.zone.center.z);
    const fill = new THREE.Mesh(
      new THREE.CircleGeometry(role.zone.radius, 96),
      new THREE.MeshBasicMaterial({ color: '#6ea8ff', transparent: true, opacity: 0.04, depthWrite: false }),
    );
    fill.position.z = -0.001;
    ring.add(fill);
    scene.add(ring);
    zones.set(id, ring);
  }

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    labels.setSize(innerWidth, innerHeight);
  });

  return {
    renderer,
    labels,
    scene,
    camera,
    controls,
    ground,
    zones,
    render() {
      renderer.render(scene, camera);
      labels.render(scene, camera);
    },
  };
}

const wood = new THREE.MeshStandardMaterial({ color: '#6b4a2f', roughness: 0.9 });
const darkWood = new THREE.MeshStandardMaterial({ color: '#4a3220', roughness: 0.9 });

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  return m;
}

function lantern(x: number, y: number, z: number, color = '#ffb35c') {
  const g = new THREE.Group();
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshBasicMaterial({ color }));
  const light = new THREE.PointLight(color, 6, 9, 1.6);
  g.add(bulb, light);
  g.position.set(x, y, z);
  return g;
}

function buildMarket(scene: THREE.Scene, at: THREE.Vector3) {
  const g = new THREE.Group();
  g.add(box(3.6, 1, 1, wood, 0, 0.5, 0));
  for (const x of [-1.7, 1.7]) g.add(box(0.12, 2.6, 0.12, darkWood, x, 1.3, -0.4));
  const canopy = new THREE.Mesh(
    new THREE.BoxGeometry(4.2, 0.08, 1.9),
    new THREE.MeshStandardMaterial({ color: '#b5463a', roughness: 0.8 }),
  );
  canopy.position.set(0, 2.6, 0);
  canopy.rotation.x = 0.18;
  canopy.castShadow = true;
  g.add(canopy);
  const crate = new THREE.MeshStandardMaterial({ color: '#8a6a3f' });
  g.add(box(0.7, 0.7, 0.7, crate, 2.4, 0.35, 0.3), box(0.5, 0.5, 0.5, crate, 2.3, 0.95, 0.3));
  const goods = ['#e6c35c', '#7fd1b9', '#d27a5a', '#c7a6ff'];
  goods.forEach((c, i) =>
    g.add(box(0.3, 0.25, 0.3, new THREE.MeshStandardMaterial({ color: c }), -1.2 + i * 0.8, 1.12, 0.1)),
  );
  g.add(lantern(-1.7, 2.3, 0.5));
  g.position.copy(at);
  scene.add(g);
}

function buildGuardPost(scene: THREE.Scene, at: THREE.Vector3) {
  const g = new THREE.Group();
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) g.add(box(0.2, 3.4, 0.2, darkWood, x, 1.7, z));
  g.add(box(2.4, 0.15, 2.4, wood, 0, 3.4, 0));
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.9, 1.2, 4), new THREE.MeshStandardMaterial({ color: '#3d4d6a' }));
  roof.position.y = 4.1;
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  g.add(roof);
  g.add(lantern(1.25, 2.6, 1.25, '#ff8a3d'));
  g.position.copy(at);
  scene.add(g);
}

function buildHut(scene: THREE.Scene, at: THREE.Vector3) {
  const g = new THREE.Group();
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.9, 2.2, 20), new THREE.MeshStandardMaterial({ color: '#8c7a62' }));
  wall.position.y = 1.1;
  wall.castShadow = wall.receiveShadow = true;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.4, 1.8, 20), new THREE.MeshStandardMaterial({ color: '#5b6b3a' }));
  roof.position.y = 3.1;
  roof.castShadow = true;
  g.add(wall, roof, lantern(1.6, 1.8, 1.4, '#ffd27a'));
  g.position.copy(at);
  scene.add(g);
}

function buildTrees(scene: THREE.Scene) {
  // deterministic scatter outside the village core
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const trunk = new THREE.MeshStandardMaterial({ color: '#4b3522' });
  const leaves = [new THREE.MeshStandardMaterial({ color: '#244a34' }), new THREE.MeshStandardMaterial({ color: '#2f5a3a' })];
  for (let i = 0; i < 70; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 22 + rnd() * 30;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const h = 2.5 + rnd() * 3;
    const t = new THREE.Group();
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.22, h * 0.4, 6), trunk);
    tr.position.y = h * 0.2;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(h * 0.35, h * 0.8, 7), leaves[i % 2]!);
    cone.position.y = h * 0.75;
    tr.castShadow = cone.castShadow = true;
    t.add(tr, cone);
    t.position.set(x, 0, z);
    scene.add(t);
  }
}
