import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { h, clear, num } from './dom.js';
import { app } from '../state.js';
import { callout, selectInput } from './common.js';
import { buildScene, heightAt } from '../scene.js';
import { ANIMAL_BUILDERS, ANIMAL_SCALE, FEATURE_BUILDERS, unitBox, unitBar } from '../models3d.js';
import { pointInPolygon, polygonCentroid, bbox, seededRng } from '../geo.js';
import { getFence } from '../data/fences.js';
import { USE_COLOR } from './labels.js';

const SKY = '#bcd8ee';
const OUTSIDE = '#a9b57d';
const TONE_GRASS = { good: '#6fae52', fair: '#98ae55', poor: '#b6a459' };
const REGION_COLOR = { garden: '#5f4630', buildings: '#bab4a5', water: '#3a7ca5', woods: '#4a7b43', exclude: '#a39379' };
const MAX_INSTANCES = 20000;

const lerpHex = (a, b, t) => `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;
const soilColor = (dark) => lerpHex('#a07c55', '#54392a', dark);

function extentOf(scene, land) {
  const points = [...scene.boundary];
  for (const z of land.zones || []) points.push(...z.polygon);
  for (const f of land.fences || []) points.push(...f.line);
  for (const m of land.markers || []) points.push(m);
  const b = bbox(points);
  const margin = Math.max(80, scene.longSide * 1.4);
  return { x0: b.minX - margin, y0: b.minY - margin, W: b.width + margin * 2, H: b.height + margin * 2 };
}

function paintGround(scene, extent) {
  const pixelsPerMeter = Math.min(2048 / extent.W, 2048 / extent.H, 4);
  const canvasWidth = Math.max(64, Math.round(extent.W * pixelsPerMeter));
  const canvasHeight = Math.max(64, Math.round(extent.H * pixelsPerMeter));
  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const context = canvas.getContext('2d');
  const toPixelX = (x) => (x - extent.x0) * pixelsPerMeter;
  const toPixelY = (y) => (extent.y0 + extent.H - y) * pixelsPerMeter;
  const trace = (polygon) => {
    context.beginPath();
    polygon.forEach((p, i) => (i ? context.lineTo(toPixelX(p.x), toPixelY(p.y)) : context.moveTo(toPixelX(p.x), toPixelY(p.y))));
    context.closePath();
  };
  const grass = TONE_GRASS[scene.tone.tone] || TONE_GRASS.fair;
  context.fillStyle = OUTSIDE;
  context.fillRect(0, 0, canvasWidth, canvasHeight);
  trace(scene.boundary);
  context.fillStyle = grass;
  context.fill();
  for (const r of scene.regions) {
    trace(r.polygon);
    context.fillStyle = r.kind === 'pasture' ? lerpHex(grass, '#5f9e48', 0.35) : r.kind === 'crop' ? soilColor(scene.soilDark) : REGION_COLOR[r.kind] || grass;
    context.fill();
    context.strokeStyle = 'rgba(0,0,0,0.25)';
    context.lineWidth = Math.max(1, 0.3 * pixelsPerMeter);
    context.stroke();
  }
  for (const p of scene.patches) {
    context.beginPath();
    context.ellipse(toPixelX(p.x), toPixelY(p.y), p.r * pixelsPerMeter, p.r * pixelsPerMeter * 0.8, 0.4, 0, Math.PI * 2);
    if (p.kind === 'bare') context.fillStyle = soilColor(scene.soilDark);
    else if (p.kind === 'weeds') context.fillStyle = '#8d9a3f';
    else context.fillStyle = '#3a7ca5';
    context.fill();
    if (p.kind === 'pond') {
      context.strokeStyle = '#d9c9a0';
      context.lineWidth = Math.max(1.5, 0.5 * pixelsPerMeter);
      context.stroke();
    }
  }
  const random = seededRng(5);
  const n = Math.min(5000, Math.round((canvasWidth * canvasHeight) / 1200));
  for (let i = 0; i < n; i++) {
    context.fillStyle = random() < 0.5 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.045)';
    const w = 3 + random() * 10;
    context.fillRect(random() * canvasWidth, random() * canvasHeight, w, w * (0.6 + random() * 0.8));
  }
  return canvas;
}

export function createContent(scene, land, evaluation, wantAnisotropy = 4) {
  const group = new THREE.Group();
  const heightOf = (x, y) => heightAt(scene.terrain, x, y);
  const random = seededRng(23);
  const labels = [];
  const layers = { fences: [], animals: [], crops: [], labels };
  const xAxis = new THREE.Vector3(1, 0, 0);
  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();
  const lambert = (options = {}) => new THREE.MeshLambertMaterial({ flatShading: true, ...options });

  const addInstanced = (geo, material, items, { cast = false, layer = null } = {}) => {
    if (!items.length) return null;
    const mesh = new THREE.InstancedMesh(geo, material, items.length);
    items.forEach((it, i) => {
      matrix.compose(it.pos, it.quat, it.scale);
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, it.color || color.set('#ffffff'));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (layer) layers[layer].push(mesh);
    return mesh;
  };

  const extent = extentOf(scene, land);
  const canvas = paintGround(scene, extent);
  const groundTexture = new THREE.CanvasTexture(canvas);
  groundTexture.colorSpace = THREE.SRGBColorSpace;
  groundTexture.anisotropy = wantAnisotropy;
  const cell = Math.max(6, Math.max(extent.W, extent.H) / 120);
  const cellsX = Math.max(2, Math.ceil(extent.W / cell));
  const cellsY = Math.max(2, Math.ceil(extent.H / cell));
  const water = (land.zones || []).filter((z) => z.use === 'water');
  const positions = new Float32Array((cellsX + 1) * (cellsY + 1) * 3);
  const uvs = new Float32Array((cellsX + 1) * (cellsY + 1) * 2);
  for (let j = 0; j <= cellsY; j++) {
    for (let i = 0; i <= cellsX; i++) {
      const x = extent.x0 + (extent.W * i) / cellsX;
      const y = extent.y0 + (extent.H * j) / cellsY;
      let height = heightOf(x, y);
      if (water.some((z) => pointInPolygon({ x, y }, z.polygon))) height -= 0.5;
      const k = j * (cellsX + 1) + i;
      positions.set([x, height, -y], k * 3);
      uvs.set([i / cellsX, j / cellsY], k * 2);
    }
  }
  const index = [];
  for (let j = 0; j < cellsY; j++) {
    for (let i = 0; i < cellsX; i++) {
      const a = j * (cellsX + 1) + i;
      const b = a + 1;
      const c = a + (cellsX + 1);
      const d = c + 1;
      index.push(a, b, c, b, d, c);
    }
  }
  const terrainGeometry = new THREE.BufferGeometry();
  terrainGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  terrainGeometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  terrainGeometry.setIndex(index);
  terrainGeometry.computeVertexNormals();
  const ground = new THREE.Mesh(terrainGeometry, lambert({ map: groundTexture }));
  ground.receiveShadow = true;
  group.add(ground);

  const barItems = (segments, thick, colorOf) =>
    segments.map((s, i) => {
      const dir = new THREE.Vector3().subVectors(s.b, s.a);
      const length = dir.length() || 0.001;
      q.setFromUnitVectors(xAxis, dir.normalize());
      return { pos: new THREE.Vector3().addVectors(s.a, s.b).multiplyScalar(0.5), quat: q.clone(), scale: new THREE.Vector3(length * 1.01, thick, thick), color: new THREE.Color(colorOf(s, i)) };
    });
  const densify = (polygon, closed, step, lift) => {
    const out = [];
    const n = closed ? polygon.length : polygon.length - 1;
    for (let i = 0; i < n; i++) {
      const a = polygon[i];
      const b = polygon[(i + 1) % polygon.length];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const k = Math.max(1, Math.ceil(length / step));
      let prev = new THREE.Vector3(a.x, heightOf(a.x, a.y) + lift, -a.y);
      for (let t = 1; t <= k; t++) {
        const x = a.x + ((b.x - a.x) * t) / k;
        const y = a.y + ((b.y - a.y) * t) / k;
        const nextPoint = new THREE.Vector3(x, heightOf(x, y) + lift, -y);
        out.push({ a: prev, b: nextPoint });
        prev = nextPoint;
      }
    }
    return out;
  };
  const outline = barItems(densify(scene.boundary, true, 4, 0.25), 0.3, () => '#ffd23f');
  addInstanced(unitBar(), new THREE.MeshBasicMaterial(), outline);

  const pieceLen = (() => {
    let total = 0;
    for (const c of scene.crops) for (const r of c.rows) total += Math.hypot(r.b.x - r.a.x, r.b.y - r.a.y);
    return Math.max(10, total / (MAX_INSTANCES * 0.8));
  })();
  const cropGeo = unitBox();
  const cropMat = lambert();
  const cropItems = [];
  for (const c of scene.crops) {
    for (const r of c.rows) {
      const length = Math.hypot(r.b.x - r.a.x, r.b.y - r.a.y);
      const k = Math.max(1, Math.ceil(length / pieceLen));
      const tint = 0.88 + random() * 0.2;
      for (let t = 0; t < k; t++) {
        const p1 = { x: r.a.x + ((r.b.x - r.a.x) * t) / k, y: r.a.y + ((r.b.y - r.a.y) * t) / k };
        const p2 = { x: r.a.x + ((r.b.x - r.a.x) * (t + 1)) / k, y: r.a.y + ((r.b.y - r.a.y) * (t + 1)) / k };
        const v1 = new THREE.Vector3(p1.x, heightOf(p1.x, p1.y) - 0.05, -p1.y);
        const v2 = new THREE.Vector3(p2.x, heightOf(p2.x, p2.y) - 0.05, -p2.y);
        const dir = new THREE.Vector3().subVectors(v2, v1);
        const l = dir.length();
        if (l < 0.01 || cropItems.length >= MAX_INSTANCES) continue;
        q.setFromUnitVectors(xAxis, dir.normalize());
        cropItems.push({ pos: new THREE.Vector3().addVectors(v1, v2).multiplyScalar(0.5), quat: q.clone(), scale: new THREE.Vector3(l * 1.02, c.height, c.rowWidth), color: new THREE.Color(c.color).multiplyScalar(tint) });
      }
    }
  }
  addInstanced(cropGeo, cropMat, cropItems, { layer: 'crops' });

  const postItems = [];
  const cornerItems = [];
  const wireItems = [];
  const panelItems = { woven47: [], netting: [] };
  const upright = new THREE.Quaternion();
  for (const f of scene.fences) {
    const fenceSpec = getFence(f.type);
    const topHeight = Math.max(0.9, f.heightM);
    const lineColor = f.type === 'electric2' ? '#f4f4f0' : f.type === 'woven47' ? '#8b5a2b' : f.type === 'netting' ? '#4d5a60' : '#8d9498';
    for (const p of f.posts) {
      const target = p.corner ? cornerItems : postItems;
      const w = p.corner ? 0.26 : 0.14;
      target.push({ pos: new THREE.Vector3(p.x, heightOf(p.x, p.y) - 0.1, -p.y), quat: upright, scale: new THREE.Vector3(w, topHeight + 0.25, w), color: new THREE.Color(p.corner ? '#7a4f27' : lineColor) });
    }
    for (const [a, b] of f.spans) {
      const startPoint = new THREE.Vector3(a.x, heightOf(a.x, a.y), -a.y);
      const endPoint = new THREE.Vector3(b.x, heightOf(b.x, b.y), -b.y);
      const dir = new THREE.Vector3().subVectors(endPoint, startPoint);
      const length = dir.length();
      if (length < 0.05) continue;
      dir.normalize();
      q.setFromUnitVectors(xAxis, dir);
      const turn = q.clone();
      if (fenceSpec.strands > 0) {
        const n = fenceSpec.strands;
        const color = f.type === 'electric2' ? '#ffd23f' : f.type === 'hightensile6' ? '#e8dca8' : '#d9dde0';
        for (let k = 0; k < n; k++) {
          const y = n === 1 ? topHeight : 0.3 + ((topHeight - 0.3) * k) / (n - 1);
          const middle = new THREE.Vector3().addVectors(startPoint, endPoint).multiplyScalar(0.5);
          middle.y += y;
          wireItems.push({ pos: middle, quat: turn, scale: new THREE.Vector3(length, 0.035, 0.035), color: new THREE.Color(color) });
        }
      } else if (panelItems[f.type]) {
        const middle = new THREE.Vector3().addVectors(startPoint, endPoint).multiplyScalar(0.5);
        middle.y += 0.08;
        panelItems[f.type].push({ pos: middle, quat: turn, scale: new THREE.Vector3(length, topHeight * 0.88, 0.03), color: new THREE.Color('#ffffff') });
        const top = middle.clone();
        top.y += topHeight * 0.88;
        wireItems.push({ pos: top, quat: turn, scale: new THREE.Vector3(length, 0.04, 0.04), color: new THREE.Color('#9aa3a8') });
      }
    }
  }
  const stride = (items) => (items.length > MAX_INSTANCES ? items.filter((_, i) => i % Math.ceil(items.length / MAX_INSTANCES) === 0) : items);
  addInstanced(unitBox(), lambert(), stride(postItems), { cast: true, layer: 'fences' });
  addInstanced(unitBox(), lambert(), stride(cornerItems), { cast: true, layer: 'fences' });
  addInstanced(unitBar(), lambert(), stride(wireItems), { layer: 'fences' });
  addInstanced(unitBox(), lambert({ transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, color: '#c4c9e0' }), stride(panelItems.woven47), { layer: 'fences' });
  addInstanced(unitBox(), lambert({ transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false, color: '#ff9f5a' }), stride(panelItems.netting), { layer: 'fences' });

  const bySpecies = new Map();
  for (const a of scene.animals) {
    if (!bySpecies.has(a.kind)) bySpecies.set(a.kind, []);
    bySpecies.get(a.kind).push(a);
  }
  for (const [kind, list] of bySpecies) {
    const build = ANIMAL_BUILDERS[kind];
    if (!build) continue;
    const scale = ANIMAL_SCALE[kind] || 1.4;
    const items = list.map((a) => {
      const s = scale * (0.92 + random() * 0.16);
      return { pos: new THREE.Vector3(a.x, heightOf(a.x, a.y), -a.y), quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a.rot), scale: new THREE.Vector3(s, s, s), color: new THREE.Color().setScalar(0.86 + random() * 0.26) };
    });
    addInstanced(build(), lambert({ vertexColors: true }), items, { cast: true, layer: 'animals' });
  }

  const byFeature = new Map();
  for (const f of scene.features) {
    if (!byFeature.has(f.kind)) byFeature.set(f.kind, []);
    byFeature.get(f.kind).push(f);
  }
  for (const [kind, list] of byFeature) {
    const build = FEATURE_BUILDERS[kind];
    if (!build) continue;
    const items = list.map((f) => ({ pos: new THREE.Vector3(f.x, heightOf(f.x, f.y), -f.y), quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.rot), scale: new THREE.Vector3(1, 1, 1) }));
    addInstanced(build(), lambert({ vertexColors: true }), items, { cast: true });
  }
  addInstanced(
    FEATURE_BUILDERS.tree(),
    lambert({ vertexColors: true }),
    scene.trees.map((t) => ({ pos: new THREE.Vector3(t.x, heightOf(t.x, t.y), -t.y), quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), random() * 6.28), scale: new THREE.Vector3(t.s, t.s, t.s), color: new THREE.Color().setScalar(0.85 + random() * 0.25) })),
    { cast: true },
  );
  const weedItems = [];
  for (const p of scene.patches.filter((x) => x.kind === 'weeds')) {
    for (let i = 0; i < 12; i++) {
      const a = random() * 6.28;
      const r = p.r * Math.sqrt(random());
      const x = p.x + Math.cos(a) * r;
      const y = p.y + Math.sin(a) * r;
      weedItems.push({ pos: new THREE.Vector3(x, heightOf(x, y), -y), quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), random() * 6.28), scale: new THREE.Vector3(1.3, 1.3, 1.3) });
    }
  }
  addInstanced(FEATURE_BUILDERS.weed(), lambert({ vertexColors: true }), weedItems);

  const livestockById = new Map((evaluation?.livestock || []).map((l) => [l.allocId, l]));
  const cropById = new Map((evaluation?.crops || []).map((c) => [c.allocId, c]));
  const hasPlanRegions = scene.regions.some((r) => !r.zone);
  for (const r of scene.regions) {
    if (r.polygon.length < 3) continue;
    if (r.zone && hasPlanRegions) continue;
    let text = r.label;
    const l = livestockById.get(r.id);
    const c = cropById.get(r.id);
    if (l) text = `${r.label}: ${num(l.heads)} head`;
    else if (c) text = `${r.label} · ${num(c.acres, 1)} ac`;
    else if (!USE_COLOR[r.kind]) continue;
    let at = polygonCentroid(r.polygon);
    if (!pointInPolygon(at, r.polygon)) {
      const b = bbox(r.polygon);
      at = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
    }
    const element = h('div', { class: 'label3d' }, text);
    const object = new CSS2DObject(element);
    object.position.set(at.x, heightOf(at.x, at.y) + 3.5, -at.y);
    group.add(object);
    labels.push(object);
  }

  return { group, layers, ground, ext: extent };
}

export function disposeGroup(group) {
  group.traverse((o) => {
    if (o.isCSS2DObject) o.element.remove();
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        m.map?.dispose();
        m.dispose();
      }
    }
    if (o.isInstancedMesh) o.dispose();
  });
  group.removeFromParent();
}

const hourText = (t) => {
  const totalMinutes = Math.round((7 + t * 12) * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = String(totalMinutes % 60).padStart(2, '0');
  return `${((hours + 11) % 12) + 1}:${minutes} ${hours >= 12 ? 'PM' : 'AM'}`;
};

export default function createView3dTab() {
  const element = h('div');
  const toolbar = h('div', { class: 'card row' });
  const stage = h('div', { class: 'view3d' });
  const note = h('div', { class: 'small muted' });
  element.append(toolbar, stage, note);

  let three = null;
  let content = null;
  let lastSig = '';
  let lastBoundarySignature = '';
  let scene = null;
  let frameId = 0;
  let dirty = true;
  let observer = null;
  let failed = '';
  const options = { sun: 0.42, shadows: true, fences: true, animals: true, crops: true, labels: true, spin: false };

  function ensureRenderer() {
    if (three || failed) return;
    try {
      const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.domElement.setAttribute('role', 'img');
      renderer.domElement.setAttribute('aria-label', 'Interactive 3D picture of your land. Drag to turn, scroll to zoom, arrow keys to move.');
      renderer.domElement.tabIndex = 0;
      const labelRenderer = new CSS2DRenderer();
      labelRenderer.domElement.className = 'labels3d';
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(SKY);
      const camera = new THREE.PerspectiveCamera(50, 1.6, 1, 20000);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.maxPolarAngle = Math.PI * 0.495;
      controls.minDistance = 2;
      controls.listenToKeyEvents(renderer.domElement);
      controls.keyPanSpeed = 25;
      controls.addEventListener('change', () => {
        dirty = true;
      });
      const skyLight = new THREE.HemisphereLight('#dff1ff', '#6b6a4a', 1.5);
      const sun = new THREE.DirectionalLight('#fff4dd', 2.6);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.6;
      scene.add(skyLight, sun, sun.target);
      three = { renderer, labelRenderer, scene, camera, controls, sun, hemi: skyLight };
      stage.prepend(labelRenderer.domElement);
      stage.prepend(renderer.domElement);
      observer = new ResizeObserver(resize);
      observer.observe(stage);
      resize();
      const loop = () => {
        frameId = requestAnimationFrame(loop);
        if (!three) return;
        const moved = three.controls.update();
        if (moved || dirty) {
          three.renderer.render(three.scene, three.camera);
          three.labelRenderer.render(three.scene, three.camera);
          dirty = false;
          element.dataset.drawCalls = String(three.renderer.info.render.calls);
        }
      };
      loop();
    } catch (e) {
      failed = e?.message || 'WebGL is not available';
      three = null;
    }
  }

  function resize() {
    if (!three) return;
    const w = Math.max(200, stage.clientWidth || 800);
    const height = Math.max(200, stage.clientHeight || 500);
    three.renderer.setSize(w, height, false);
    three.labelRenderer.setSize(w, height);
    three.camera.aspect = w / height;
    three.camera.updateProjectionMatrix();
    dirty = true;
  }

  function placeSun() {
    if (!three || !scene || scene.empty) return;
    const radius = Math.max(150, scene.longSide * 1.2);
    const theta = options.sun * Math.PI;
    const elevation = ((8 + Math.sin(theta) * 58) * Math.PI) / 180;
    const target = three.controls.target;
    three.sun.target.position.copy(target);
    three.sun.position.set(target.x + Math.cos(theta) * Math.cos(elevation) * radius, target.y + Math.sin(elevation) * radius, target.z + Math.sin(theta) * Math.cos(elevation) * radius);
    const s = radius * 0.9;
    const shadowCamera = three.sun.shadow.camera;
    shadowCamera.left = -s;
    shadowCamera.right = s;
    shadowCamera.top = s;
    shadowCamera.bottom = -s;
    shadowCamera.near = 1;
    shadowCamera.far = radius * 4;
    shadowCamera.updateProjectionMatrix();
    three.sun.intensity = 1.2 + Math.sin(theta) * 1.6;
    three.sun.castShadow = options.shadows;
    dirty = true;
  }

  function setView(kind) {
    if (!three || !scene || scene.empty) return;
    const radius = Math.max(scene.longSide, 40);
    const heightOf = (x, y) => heightAt(scene.terrain, x, y);
    const t = new THREE.Vector3(scene.center.x, heightOf(scene.center.x, scene.center.y) + 1, -scene.center.y);
    three.controls.target.copy(t);
    if (kind === 'top') three.camera.position.set(t.x, t.y + radius * 1.5 + 40, t.z + 0.01);
    else if (kind === 'ground') {
      const p0 = scene.boundary.reduce((a, b) => (b.y < a.y ? b : a));
      const dx = scene.center.x - p0.x;
      const dy = scene.center.y - p0.y;
      const d = Math.hypot(dx, dy) || 1;
      const step = Math.min(10, d * 0.2);
      const p = { x: p0.x + (dx / d) * step, y: p0.y + (dy / d) * step };
      three.camera.position.set(p.x, heightOf(p.x, p.y) + 1.8, -p.y);
      t.y += 0.5;
      three.controls.target.copy(t);
    } else three.camera.position.set(t.x + radius * 0.55, t.y + radius * 0.7 + 20, t.z + radius * 0.95 + 30);
    three.scene.fog = new THREE.Fog(SKY, radius * 1.8, radius * 4.2 + 200);
    three.controls.update();
    placeSun();
    dirty = true;
  }

  function applyLayerVisibility() {
    if (!content) return;
    for (const m of content.layers.fences) m.visible = options.fences;
    for (const m of content.layers.animals) m.visible = options.animals;
    for (const m of content.layers.crops) m.visible = options.crops;
    for (const l of content.layers.labels) l.visible = options.labels;
    dirty = true;
  }

  function rebuild() {
    const profile = app.profile;
    const plan = app.plan;
    const evaluation = plan ? app.evaluate(plan) : null;
    scene = buildScene(profile, plan, evaluation);
    if (content && three) {
      disposeGroup(content.group);
      content = null;
    }
    if (scene.empty || !three) return;
    content = createContent(scene, app.land, evaluation, three.renderer.capabilities.getMaxAnisotropy());
    three.scene.add(content.group);
    const boundarySignature = JSON.stringify(scene.boundary);
    const first = boundarySignature !== lastBoundarySignature;
    lastBoundarySignature = boundarySignature;
    if (first) setView('home');
    else placeSun();
    applyLayerVisibility();
    element.dataset.animals = String(scene.stats.animals);
    element.dataset.posts = String(scene.stats.posts);
    element.dataset.rows = String(scene.stats.rows);
    dirty = true;
  }

  function renderToolbar() {
    clear(toolbar);
    const plans = app.profile.plans;
    const check = (key, text) => h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: options[key], 'data-key': `v3-${key}`, onchange: (e) => {
      options[key] = e.target.checked;
      if (key === 'shadows') placeSun();
      else if (key === 'spin') {
        if (three) three.controls.autoRotate = options.spin;
      } else applyLayerVisibility();
    } }), text);
    const timeLabel = h('span', { class: 'small', 'data-key': 'v3-time' }, hourText(options.sun));
    toolbar.append(
      plans.length ? h('div', { class: 'field tight' }, h('label', { for: 'v3plan' }, 'Plan shown'), (() => {
        const selected = selectInput({ value: app.plan?.id, key: 'v3-plan', options: plans.map((p) => ({ value: p.id, label: p.name })), onChange: (v) => v && app.setActivePlan(v) });
        selected.id = 'v3plan';
        return selected;
      })()) : h('span', { class: 'small muted' }, 'No plan yet. This shows your land and the animals you tapped.'),
      h('div', { class: 'field tight' }, h('label', { for: 'v3sun' }, 'Time of day'), h('div', { class: 'row tight' }, h('input', { id: 'v3sun', type: 'range', min: 0, max: 100, value: Math.round(options.sun * 100), 'data-key': 'v3-sun', oninput: (e) => {
        options.sun = Number(e.target.value) / 100;
        timeLabel.textContent = hourText(options.sun);
        placeSun();
      } }), timeLabel)),
      check('shadows', 'Shadows'),
      check('fences', 'Fences'),
      check('animals', 'Animals'),
      check('crops', 'Crops'),
      check('labels', 'Labels'),
      check('spin', 'Slow spin'),
    );
  }

  function renderOverlay() {
    clear(stage);
    if (three) {
      stage.append(three.renderer.domElement, three.labelRenderer.domElement);
    }
    if (!scene || scene.empty) return;
    const plan = app.plan;
    const rows = scene.legend.map((l) => h('div', {}, `${l.label}: ${l.preview ? `${l.shown} placed (preview)` : `${num(l.heads)} head`}${l.perIcon > 1 ? `, 1 shape = ${l.perIcon}` : ''}`));
    stage.append(
      h('div', { class: 'overlay' },
        h('strong', {}, plan ? plan.name : 'Your land'),
        h('div', { class: 'small' }, `${num(scene.stats.acres, 1)} acres · ${scene.stats.posts} fence posts`),
        rows.length ? h('div', { class: 'small' }, rows) : null,
      ),
      h('div', { class: 'controls' },
        h('button', { class: 'small', onclick: () => setView('home') }, 'Reset view'),
        h('button', { class: 'small', onclick: () => setView('top') }, 'Top view'),
        h('button', { class: 'small', onclick: () => setView('ground') }, 'Ground view'),
      ),
    );
  }

  function renderNote() {
    clear(note);
    if (!scene || scene.empty) return;
    const photoNote = scene.tone.from === 'photo' ? `grass color from your photo (looks ${scene.tone.tone})` : `grass color from your soil fit (${scene.tone.tone})`;
    note.append(h('p', { class: 'small muted' }, `Stylized picture, not a survey. Animals are drawn larger than life so a herd is easy to see. Slope shown: ${num(scene.terrain.slopePct, 1)}% (from your soil entry or photo, otherwise assumed flat). Ground: ${photoNote}.`));
  }

  function render() {
    renderToolbar();
    const profile = app.profile;
    const signature = JSON.stringify([profile.land, app.plan, profile.overrides]);
    if (signature === lastSig && (three || failed)) {
      renderOverlay();
      return;
    }
    lastSig = signature;
    const probe = buildScene(profile, app.plan, null);
    if (probe.empty) {
      scene = probe;
      if (content && three) {
        disposeGroup(content.group);
        content = null;
      }
      clear(stage);
      stage.append(h('div', { class: 'overlay' }, h('strong', {}, '3D view'), h('p', { class: 'small' }, probe.reason), h('button', { onclick: () => { location.hash = 'map'; } }, 'Open the map')));
      renderNote();
      return;
    }
    ensureRenderer();
    rebuild();
    renderOverlay();
    renderNote();
    if (failed && scene && !scene.empty) {
      const flat = paintGround(scene, extentOf(scene, app.land));
      flat.setAttribute('role', 'img');
      flat.setAttribute('aria-label', 'Flat top-down picture of your land');
      flat.className = 'flat-ground';
      stage.prepend(flat);
      stage.append(h('div', { class: 'overlay', style: { top: 'auto', bottom: '10px' } }, callout('warn', 'Your browser could not start 3D graphics, so this is a flat top-down picture instead.')));
    }
    element.dataset.ready = failed ? 'fallback' : 'true';
  }

  return {
    el: element,
    render,
    destroy() {
      cancelAnimationFrame(frameId);
      observer?.disconnect();
      if (content) disposeGroup(content.group);
      if (three) {
        three.controls.dispose();
        three.renderer.dispose();
        three.renderer.forceContextLoss();
      }
      three = null;
      content = null;
    },
  };
}
