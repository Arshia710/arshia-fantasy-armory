/**
 * bbmodel-loader.js  —  Blockbench (.bbmodel) -> Three.js (r170+)
 *
 * Supports Java Block/Item models and Bedrock (box UV) models:
 *   - cubes (from/to/origin/rotation/inflate), nested groups (outliner), per-face UVs
 *   - embedded base64 textures, NearestFilter, alpha analysis (opaque / cutout / blend)
 *   - flipbook (animated) textures: 48x2880 -> 60 frames of 48x48, etc.
 *   - emissive: element.light_emission (0-15) and texture render_mode (emissive / additive)
 *   - optional Minecraft "display" pose (gui, fixed, ...), auto center + auto scale
 *
 * Usage:
 *   import { loadBBModel, frameModel, addDefaultLights } from './bbmodel-loader.js';
 *   const model = await loadBBModel('models/flamberge.bbmodel');   // URL | File | Blob | parsed JSON
 *   scene.add(model.object);
 *   frameModel(camera, controls, model);
 *   // in the render loop:  model.update(clock.getDelta());
 *   // on close:            model.dispose();
 *
 * Coordinates: Blockbench space == Three.js space (Y up, north = -Z, east = +X, 1 unit = 1/16 block).
 */
import * as THREE from 'three';

/* ======================================================================
 * 1. PURE PARSING  (no Three.js here: only plain arrays / typed arrays)
 * ====================================================================== */

const FACE_ORDER = ['north', 'east', 'south', 'west', 'up', 'down'];

// Corners are listed [top-left, top-right, bottom-right, bottom-left] AS SEEN FROM OUTSIDE the face,
// which is exactly how Minecraft/Blockbench interpret a face uv = [u1, v1, u2, v2].
const FACES = {
  north: { n: [0, 0, -1], c: (a, b) => [[b[0], b[1], a[2]], [a[0], b[1], a[2]], [a[0], a[1], a[2]], [b[0], a[1], a[2]]] },
  south: { n: [0, 0, 1],  c: (a, b) => [[a[0], b[1], b[2]], [b[0], b[1], b[2]], [b[0], a[1], b[2]], [a[0], a[1], b[2]]] },
  east:  { n: [1, 0, 0],  c: (a, b) => [[b[0], b[1], b[2]], [b[0], b[1], a[2]], [b[0], a[1], a[2]], [b[0], a[1], b[2]]] },
  west:  { n: [-1, 0, 0], c: (a, b) => [[a[0], b[1], a[2]], [a[0], b[1], b[2]], [a[0], a[1], b[2]], [a[0], a[1], a[2]]] },
  up:    { n: [0, 1, 0],  c: (a, b) => [[a[0], b[1], a[2]], [b[0], b[1], a[2]], [b[0], b[1], b[2]], [a[0], b[1], b[2]]] },
  down:  { n: [0, -1, 0], c: (a, b) => [[a[0], a[1], b[2]], [b[0], a[1], b[2]], [b[0], a[1], a[2]], [a[0], a[1], a[2]]] },
};

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Bedrock box-UV layout (only used when a face has no stored uv). */
function boxUV(el) {
  const [ox, oy] = el.uv_offset ?? [0, 0];
  const [sx, sy, sz] = [0, 1, 2].map((i) => Math.floor(Math.abs(el.to[i] - el.from[i])));
  const mirror = !!el.mirror_uv;
  const f = {
    east:  [ox, oy + sz, ox + sz, oy + sz + sy],
    north: [ox + sz, oy + sz, ox + sz + sx, oy + sz + sy],
    west:  [ox + sz + sx, oy + sz, ox + 2 * sz + sx, oy + sz + sy],
    south: [ox + 2 * sz + sx, oy + sz, ox + 2 * sz + 2 * sx, oy + sz + sy],
    up:    [ox + sz + sx, oy + sz, ox + sz, oy],
    down:  [ox + sz + 2 * sx, oy, ox + sz + sx, oy + sz],
  };
  if (mirror) {
    for (const k in f) f[k] = [f[k][2], f[k][1], f[k][0], f[k][3]];
    [f.east, f.west] = [f.west, f.east];
  }
  return f;
}

function resolveTextureIndex(ref, textures) {
  if (ref === null || ref === undefined || ref === false) return -1; // no texture -> face is not drawn
  let i = typeof ref === 'number' ? ref : parseInt(String(ref).replace('#', ''), 10);
  if (Number.isNaN(i)) i = textures.findIndex((t) => t.name === ref);
  return textures[i] ? i : -1;
}

/** Fraction of the pixels inside a uv rectangle that are (at least slightly) opaque. alpha = 1 byte per pixel. */
export function regionOpacity(alpha, imgW, imgH, uvW, uvH, uv) {
  const sx = imgW / uvW, sy = imgH / uvH;
  const x0 = Math.max(0, Math.floor(Math.min(uv[0], uv[2]) * sx)), x1 = Math.min(imgW, Math.ceil(Math.max(uv[0], uv[2]) * sx));
  const y0 = Math.max(0, Math.floor(Math.min(uv[1], uv[3]) * sy)), y1 = Math.min(imgH, Math.ceil(Math.max(uv[1], uv[3]) * sy));
  if (x1 <= x0 || y1 <= y0) return 1; // degenerate region: don't guess
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (alpha[y * imgW + x] >= 16) n++;
  return n / ((x1 - x0) * (y1 - y0));
}

/** face side mode ('auto' | 'front' | 'double') + the model-wide default -> draw double-sided? */
export const isDoubleSided = (side, forceDouble) => side === 'double' || (side === 'auto' && !!forceDouble);

const OPPOSITE = [['north', 'south', 2], ['east', 'west', 0], ['up', 'down', 1]]; // [face, opposite face, axis]

/**
 * Builds the geometry of one cube, relative to the cube's own origin (its rotation pivot).
 * faceOpacity(textureIndex, uv) -> 0..1 tells how much of a face's uv region is painted.
 */
function buildCubeGeometry(el, textures, faceOpacity) {
  const inf = el.inflate || 0;
  const o = el.origin ?? [0, 0, 0];
  const a = [el.from[0] - inf - o[0], el.from[1] - inf - o[1], el.from[2] - inf - o[2]];
  const b = [el.to[0] + inf - o[0], el.to[1] + inf - o[1], el.to[2] + inf - o[2]];
  const derived = el.box_uv ? boxUV(el) : null;

  // 1) resolve every textured face
  const faces = {};
  for (const dir of FACE_ORDER) {
    const face = el.faces?.[dir];
    if (!face) continue;
    const ti = resolveTextureIndex(face.texture, textures);
    if (ti < 0) continue; // null texture -> face is not drawn
    const { uvWidth, uvHeight } = textures[ti];
    faces[dir] = { ti, face, uv: face.uv ?? derived?.[dir] ?? [0, 0, uvWidth, uvHeight], side: 'auto' };
  }

  // 2) zero-thickness cubes (wings, braids, planes): their two opposite faces lie in the same plane.
  //    Artists usually paint only ONE of them, and Minecraft armor is rendered without back-face culling,
  //    so the painted side is visible from both directions in game. Do the same: drop the unpainted face
  //    and draw the painted one double-sided. If both are painted each keeps its own side (single-sided),
  //    otherwise two coplanar double-sided quads would z-fight.
  for (const [A, B, axis] of OPPOSITE) {
    if (Math.abs(b[axis] - a[axis]) > 1e-6) continue;
    const fa = faces[A], fb = faces[B];
    if (fa && fb) {
      const oa = faceOpacity(fa.ti, fa.uv), ob = faceOpacity(fb.ti, fb.uv);
      if (oa === 0 && ob > 0) { delete faces[A]; fb.side = 'double'; }
      else if (ob === 0 && oa > 0) { delete faces[B]; fa.side = 'double'; }
      else fa.side = fb.side = 'front';
    } else if (fa || fb) (fa ?? fb).side = 'double';
  }

  // 3) bucket faces by (texture, side) so each bucket becomes one material group
  const buckets = new Map();
  for (const dir of FACE_ORDER) {
    const f = faces[dir];
    if (!f) continue;
    const key = `${f.ti}|${f.side}`;
    if (!buckets.has(key)) buckets.set(key, { ti: f.ti, side: f.side, list: [] });
    buckets.get(key).list.push([dir, f.face, f.uv]);
  }
  if (!buckets.size) return null;

  const positions = [], normals = [], uvs = [], indices = [], groups = [];
  let vertex = 0;
  for (const { ti, side, list } of buckets.values()) {
    const start = indices.length;
    const { uvWidth, uvHeight } = textures[ti];
    for (const [dir, face, uvRect] of list) {
      const def = FACES[dir];
      const [u1, v1, u2, v2] = uvRect;
      const uv = [[u1, v1], [u2, v1], [u2, v2], [u1, v2]]; // TL, TR, BR, BL
      const shift = (((face.rotation ?? 0) / 90) % 4 + 4) % 4; // face uv rotation (java)
      const corners = def.c(a, b);
      for (let k = 0; k < 4; k++) {
        const [u, v] = uv[(k - shift + 4) % 4];
        positions.push(...corners[k]);
        normals.push(...def.n);
        uvs.push(u / uvWidth, 1 - v / uvHeight); // v flipped: Three.js uv origin is bottom-left
      }
      indices.push(vertex, vertex + 3, vertex + 2, vertex, vertex + 2, vertex + 1); // CCW seen from outside
      vertex += 4;
    }
    groups.push({ start, count: indices.length - start, textureIndex: ti, side });
  }
  return {
    positions: new Float32Array(positions), normals: new Float32Array(normals),
    uvs: new Float32Array(uvs), indices: new Uint16Array(indices), groups,
  };
}

/** Texture metadata only (no geometry), so textures can be loaded before the geometry is built. */
export function parseTextureInfo(json) {
  const resW = json.resolution?.width ?? 16, resH = json.resolution?.height ?? 16;
  return (json.textures ?? []).map((t, i) => ({
    index: i,
    name: t.name ?? `texture_${i}`,
    source: t.source ?? null,
    path: t.path ?? t.relative_path ?? null,
    uvWidth: t.uv_width || resW,
    uvHeight: t.uv_height || resH,
    frameTime: t.frame_time ?? 1,                    // ticks per frame (20 ticks = 1 s), like mcmeta
    frameOrderType: t.frame_order_type ?? 'loop',
    frameOrder: t.frame_order ?? '',
    renderMode: t.render_mode ?? 'default',          // default | emissive | additive | layered
  }));
}

/**
 * bbmodel JSON -> plain data tree.  Pure function (also usable in Node for tests).
 * Each node has position/rotation RELATIVE to its parent (Blockbench stores absolute pivots).
 * faceOpacity(textureIndex, uv) is optional; the loader passes it so flat cubes can be fixed up.
 */
export function parseBBModel(json, { includeHidden = false, faceOpacity = () => 1 } = {}) {
  const warnings = [];
  const format = json.meta?.model_format ?? json.model_format ?? 'free';
  const textures = parseTextureInfo(json);

  const elements = new Map((json.elements ?? []).map((e) => [e.uuid, e]));
  const groupDefs = new Map((json.groups ?? []).filter((g) => g && typeof g === 'object').map((g) => [g.uuid, g]));
  const placed = new Set();

  const makeCube = (el, parentOrigin) => {
    if (el.type && el.type !== 'cube') { warnings.push(`unsupported element type "${el.type}" (${el.name})`); return null; }
    if (el.visibility === false && !includeHidden) return null;
    const geometry = buildCubeGeometry(el, textures, faceOpacity);
    if (!geometry) return null;
    return {
      kind: 'cube', name: el.name ?? '',
      position: sub(el.origin ?? [0, 0, 0], parentOrigin),
      rotation: el.rotation ?? [0, 0, 0],
      emission: el.light_emission ?? 0,
      flat: el.shade === false,
      geometry,
    };
  };

  const walk = (entry, parentOrigin, out) => {
    if (typeof entry === 'string') {                       // element uuid
      const el = elements.get(entry);
      if (!el || placed.has(entry)) return;
      placed.add(entry);
      const cube = makeCube(el, parentOrigin);
      if (cube) out.push(cube);
      return;
    }
    // modern files: outliner node = {uuid, children} + definition in json.groups; legacy: everything inline
    const def = { ...(groupDefs.get(entry.uuid) ?? {}), ...entry };
    if (def.visibility === false && !includeHidden) return;
    const origin = def.origin ?? [0, 0, 0];
    const node = { kind: 'group', name: def.name ?? '', position: sub(origin, parentOrigin), rotation: def.rotation ?? [0, 0, 0], children: [] };
    for (const child of def.children ?? []) walk(child, origin, node.children);
    out.push(node);
  };

  const root = { kind: 'group', name: 'root', position: [0, 0, 0], rotation: [0, 0, 0], children: [] };
  for (const entry of json.outliner ?? []) walk(entry, [0, 0, 0], root.children);
  for (const uuid of elements.keys()) if (!placed.has(uuid)) walk(uuid, [0, 0, 0], root.children); // orphans

  return { name: json.name ?? 'model', format, textures, tree: root, display: json.display ?? {}, warnings };
}

/* ======================================================================
 * 2. THREE.JS LAYER
 * ====================================================================== */

const DEG = Math.PI / 180;

async function loadImage(src) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = src;
  await img.decode();
  return img;
}

function analyzeAlpha(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const alpha = new Uint8Array(c.width * c.height);
  let clear = 0, partial = 0;
  for (let i = 3, p = 0; i < d.length; i += 4, p++) {
    const a = d[i];
    alpha[p] = a;
    if (a === 0) clear++; else if (a < 255) partial++;
  }
  return { mode: partial ? 'blend' : clear ? 'cutout' : 'opaque', alpha };
}

function missingTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 16;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 16, 16);
  ctx.fillStyle = '#f0f'; ctx.fillRect(0, 0, 8, 8); ctx.fillRect(8, 8, 8, 8);
  return new THREE.CanvasTexture(c);
}

function frameSequence(frames, type, custom) {
  const seq = [...Array(frames).keys()];
  if (type === 'backwards') return seq.reverse();
  if (type === 'back_and_forth') return seq.concat(seq.slice(1, -1).reverse());
  if (type === 'custom') {
    const list = String(custom).split(/[\s,]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < frames);
    if (list.length) return list;
  }
  return seq;
}

/** Loads every texture of the model and prepares its flipbook (if the image is a frame strip). */
async function createTextures(textures, opts) {
  return Promise.all(textures.map(async (t) => {
    let img = null;
    const src = t.source ?? opts.textureResolver?.(t) ?? null;
    if (src) { try { img = await loadImage(src); } catch (e) { console.warn(`[bbmodel] texture "${t.name}" failed to load`, e); } }

    const texture = img ? new THREE.Texture(img) : missingTexture();
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;      // crisp pixel art
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;

    // A frame has the aspect ratio uv_width : uv_height; a taller image is a flipbook strip.
    let frames = 1;
    if (img) {
      const frameHeight = img.naturalWidth * t.uvHeight / t.uvWidth;
      frames = Math.max(1, Math.floor(img.naturalHeight / frameHeight + 1e-6));
    }
    let flipbook = null;
    if (frames > 1) {
      texture.repeat.set(1, 1 / frames);
      texture.offset.set(0, 1 - 1 / frames);
      const secondsPerFrame = opts.fps ? 1 / opts.fps : Math.max(t.frameTime, 1) / 20;
      flipbook = { texture, frames, seq: frameSequence(frames, t.frameOrderType, t.frameOrder), secondsPerFrame, current: -1 };
    }
    const { mode, alpha } = img ? analyzeAlpha(img) : { mode: 'cutout', alpha: null };
    // animated strips are not analysed (frame contents change), static textures answer "how painted is this uv rect"
    const opacity = (uv) => (alpha && frames === 1 ? regionOpacity(alpha, img.naturalWidth, img.naturalHeight, t.uvWidth, t.uvHeight, uv) : 1);
    return { texture, frames, flipbook, alpha: mode, opacity };
  }));
}

function applyFlipbook(fb, time) {
  const step = Math.floor(time / fb.secondsPerFrame) % fb.seq.length;
  const frame = fb.seq[step];
  if (frame === fb.current) return;
  fb.current = frame;
  fb.texture.offset.y = 1 - (frame + 1) / fb.frames; // image is flipped on upload: frame 0 is the top
}

export class BBModel {
  constructor(object, info, flipbooks, disposables) {
    this.object = object;            // add this to your scene (already centered at 0,0,0 and scaled)
    this.info = info;
    this.playing = true;             // pause flipbook animation
    this.speed = 1;
    this.time = 0;
    this._flipbooks = flipbooks;
    this._disposables = disposables;
    this.update(0);
  }
  update(dt = 0) {
    if (this.playing) this.time += dt * this.speed;
    for (const fb of this._flipbooks) applyFlipbook(fb, this.time);
  }
  dispose() {
    this.object.removeFromParent();
    this._disposables.forEach((d) => d.dispose());
  }
}

function readSource(source) {
  if (typeof source === 'string') return fetch(source).then((r) => { if (!r.ok) throw new Error(`${source}: HTTP ${r.status}`); return r.json(); });
  if (typeof Blob !== 'undefined' && source instanceof Blob) return source.text().then(JSON.parse);
  return Promise.resolve(source); // already-parsed object
}

/**
 * @param {string|Blob|object} source  URL, File/Blob or parsed bbmodel JSON
 * @param {object} [options]
 * @param {number}  [options.size=1]       largest dimension of the final model, in scene units
 * @param {string|null} [options.display]  'gui' | 'fixed' | 'ground' | ... apply the model's Minecraft display pose.
 *                                         Default: 'gui' for Java Block models, none for Bedrock. null = raw geometry.
 * @param {number}  [options.fps]          force flipbook speed (default: mcmeta-like, frame_time ticks at 20 tps)
 * @param {boolean} [options.unlit=false]  MeshBasicMaterial everywhere (no lights needed)
 * @param {boolean} [options.doubleSided]  draw all faces double-sided. Default: true for Bedrock/entity (armor) models,
 *                                         false for Java blocks/items. Flat one-sided planes are always double-sided.
 * @param {boolean} [options.includeHidden=false]
 * @param {(tex)=>string} [options.textureResolver]  url for textures that are not embedded
 */
export async function loadBBModel(source, options = {}) {
  const opts = { size: 1, unlit: false, includeHidden: false, fps: null, textureResolver: null, ...options };
  const json = await readSource(source);
  const texSet = await createTextures(parseTextureInfo(json), opts);
  const parsed = parseBBModel(json, { includeHidden: opts.includeHidden, faceOpacity: (ti, uv) => texSet[ti].opacity(uv) });

  // Minecraft renders armor/entity models without back-face culling (you see the inside of a helmet); Java blocks/items are culled
  const forceDouble = opts.doubleSided ?? /bedrock|entity/.test(parsed.format);
  const disposables = [];
  const materialCache = new Map();
  const getMaterial = (ti, emission, flat, double) => {
    const key = `${ti}|${emission}|${flat}|${double}`;
    if (materialCache.has(key)) return materialCache.get(key);
    const t = texSet[ti], mode = parsed.textures[ti].renderMode;
    const e = mode === 'emissive' ? 15 : emission;
    const p = { map: t.texture, side: double ? THREE.DoubleSide : THREE.FrontSide };
    if (t.alpha === 'cutout') p.alphaTest = 0.5;
    if (t.alpha === 'blend') Object.assign(p, { transparent: true, alphaTest: 0.01, depthWrite: false });
    if (mode === 'additive') Object.assign(p, { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    let m;
    if (opts.unlit || flat || e >= 15) m = new THREE.MeshBasicMaterial(p);          // fully emissive = ignores lights
    else {
      m = new THREE.MeshLambertMaterial(p);
      if (e > 0) { m.emissive.set(0xffffff); m.emissiveMap = t.texture; m.emissiveIntensity = e / 15; }
    }
    materialCache.set(key, m); disposables.push(m);
    return m;
  };

  const build = (node) => {
    let obj;
    if (node.kind === 'cube') {
      const g = node.geometry;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(g.positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(g.normals, 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(g.uvs, 2));
      geometry.setIndex(new THREE.BufferAttribute(g.indices, 1));
      g.groups.forEach((grp, i) => geometry.addGroup(grp.start, grp.count, i));
      disposables.push(geometry);
      obj = new THREE.Mesh(geometry, g.groups.map((grp) => getMaterial(grp.textureIndex, node.emission, node.flat, isDoubleSided(grp.side, forceDouble))));
    } else {
      obj = new THREE.Group();
      for (const child of node.children) obj.add(build(child));
    }
    obj.name = node.name;
    obj.position.set(...node.position);
    obj.rotation.set(node.rotation[0] * DEG, node.rotation[1] * DEG, node.rotation[2] * DEG, 'ZYX'); // Blockbench order
    return obj;
  };

  const object = new THREE.Group();
  object.name = parsed.name;
  const fit = new THREE.Group();   // centering + scaling happen here, so `object` stays at identity
  object.add(fit);

  let mount = fit;
  const displayKey = opts.display === undefined ? (parsed.format === 'java_block' ? 'gui' : null) : opts.display;
  const d = displayKey && parsed.display[displayKey];
  if (d) {
    // Minecraft: translate * rotateXYZ * scale, around the model center (8,8,8)
    const pose = new THREE.Group();
    pose.position.set(...(d.translation ?? [0, 0, 0]));
    const r = d.rotation ?? [0, 0, 0];
    pose.rotation.set(r[0] * DEG, r[1] * DEG, r[2] * DEG, 'XYZ');
    pose.scale.set(...(d.scale ?? [1, 1, 1]));
    const content = new THREE.Group();
    content.position.set(-8, -8, -8);
    pose.add(content); fit.add(pose);
    mount = content;
  }
  mount.add(build(parsed.tree));

  // auto center + scale (bounding box of the real geometry, after every transform)
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(fit, true);
  if (!box.isEmpty()) {
    const size = box.getSize(new THREE.Vector3());
    const scale = opts.size / (Math.max(size.x, size.y, size.z) || 1);
    fit.scale.setScalar(scale);
    fit.position.copy(box.getCenter(new THREE.Vector3())).multiplyScalar(-scale);
  } else parsed.warnings.push('model has no visible geometry');

  const flipbooks = texSet.map((t) => t.flipbook).filter(Boolean);
  texSet.forEach((t) => disposables.push(t.texture));

  const model = new BBModel(object, {
    name: parsed.name, format: parsed.format, warnings: parsed.warnings,
    textures: parsed.textures.map((t, i) => ({ name: t.name, frames: texSet[i].frames, alpha: texSet[i].alpha })),
  }, flipbooks, disposables);
  // Bedrock/entity models face north (-Z); Java items are viewed from +Z (south), like the inventory icon
  model.viewDirection = new THREE.Vector3(...(/bedrock|entity/.test(parsed.format) ? [0.5, 0.25, -1] : [0.35, 0.25, 1])).normalize();
  return model;
}

/** Puts the camera on the model's good side at the right distance and aims the controls at it. */
export function frameModel(camera, controls, model, { margin = 1.15, direction } = {}) {
  const sphere = new THREE.Box3().setFromObject(model.object, true).getBoundingSphere(new THREE.Sphere());
  const vFov = camera.fov * DEG;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const distance = (sphere.radius * margin) / Math.sin(Math.min(vFov, hFov) / 2);
  const dir = (direction ?? model.viewDirection).clone().normalize();
  camera.position.copy(sphere.center).addScaledVector(dir, distance);
  camera.near = distance / 100;
  camera.far = distance * 100;
  camera.updateProjectionMatrix();
  controls.target.copy(sphere.center);
  controls.update();
}

/**
 * Lights for MeshLambertMaterial. Since r155 light intensities are physical (no implicit * PI),
 * so values around 1 look dark: ambient ~ PI * 0.55 and key ~ PI * 0.5 give a texture-true result.
 */
export function addDefaultLights(scene) {
  scene.add(new THREE.AmbientLight(0xffffff, 1.8));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(2, 3, 4);
  const fill = new THREE.DirectionalLight(0xaabbff, 0.6);
  fill.position.set(-3, 1, -2);
  scene.add(key, fill);
}
