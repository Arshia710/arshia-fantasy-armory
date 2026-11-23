import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { loadBBModel, frameModel, addDefaultLights } from "./bbmodel-loader.js";

let renderer, scene, camera, controls, raf, host;
let currentModel = null; // legacy glTF scene
let bbModel = null;      // BBModel from bbmodel-loader.js
let mixer = null;
let clock = null;
let session = 0;         // bumped on every open/close so late async loads can be ignored

export function closeViewer() {
  session++;
  if (raf) cancelAnimationFrame(raf);
  raf = null;
  if (mixer) {
    mixer.stopAllAction();
    mixer = null;
  }
  if (bbModel) {
    bbModel.dispose();
    bbModel = null;
  }
  clock = null;
  if (renderer) {
    renderer.dispose();
    renderer.forceContextLoss(); // browsers allow only ~16 live WebGL contexts
    renderer.domElement.remove();
    renderer = null;
  }
  scene = null;
  camera = null;
  controls = null;
  currentModel = null;
  host = null;
}

// "models/x.bbmodel" -> also try "models/x.geo.bbmodel" (Bedrock exports); glb <-> gltf swap as before
function candidates(source) {
  const list = [];
  for (const url of [].concat(source || [])) {
    list.push(url);
    if (/\.bbmodel$/i.test(url) && !/\.geo\.bbmodel$/i.test(url)) list.push(url.replace(/\.bbmodel$/i, ".geo.bbmodel"));
    if (/\.glb$/i.test(url)) list.push(url.replace(/\.glb$/i, ".gltf"));
    if (/\.gltf$/i.test(url)) list.push(url.replace(/\.gltf$/i, ".glb"));
  }
  return [...new Set(list)];
}

// Pose of Java item models:
//   null  = raw geometry exactly as modeled in Blockbench (upright, no in-game tilt)
//   "gui" = like the in-game inventory icon (uses the model's own "display.gui" values)
const BB_DISPLAY = null;

async function loadAny(url) {
  if (/\.bbmodel$/i.test(url)) return { bb: await loadBBModel(url, { size: 1.4, display: BB_DISPLAY }) };
  return { gltf: await new GLTFLoader().loadAsync(url) };
}

/**
 * @param container   preview element
 * @param source      model url, or an array of urls to try in order (.bbmodel / .gltf / .glb)
 * @param fallbackImg thumbnail shown while loading and if nothing loads
 */
export async function openViewer(container, source, fallbackImg) {
  closeViewer();
  const mine = session;
  container.classList.remove("has-viewer");
  if (fallbackImg) container.innerHTML = `<img src="${fallbackImg}" alt="" />`;
  else container.textContent = "Loading 3D model…";

  // Load first, create the WebGL renderer only if something actually loaded
  let loaded = null;
  let lastErr = null;
  for (const url of candidates(source)) {
    try {
      loaded = await loadAny(url);
      break;
    } catch (e) {
      lastErr = e;
    }
    if (mine !== session) return;
  }
  if (mine !== session) {
    // modal closed (or another item opened) while loading
    loaded?.bb?.dispose();
    return;
  }
  if (!loaded) {
    console.warn("3D model not found / failed to load, fallback image", source, lastErr);
    if (!fallbackImg) container.textContent = "No 3D model";
    return;
  }

  try {
    host = container;
    container.innerHTML = "";
    container.classList.add("has-viewer");

    const width = container.clientWidth || 480;
    const height = container.clientHeight || 420;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0c10);

    camera = new THREE.PerspectiveCamera(35, width / height, 0.01, 100);
    camera.position.set(1.2, 1.0, 1.8);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.2;
    clock = new THREE.Clock();

    if (loaded.bb) {
      bbModel = loaded.bb;
      addDefaultLights(scene);
      scene.add(bbModel.object);
      frameModel(camera, controls, bbModel); // already centered + scaled by the loader
    } else {
      // legacy glTF path
      scene.add(new THREE.AmbientLight(0xffffff, 0.85));
      const dir = new THREE.DirectionalLight(0xffffff, 1.1);
      dir.position.set(3, 5, 4);
      scene.add(dir);
      const fill = new THREE.DirectionalLight(0x88aaff, 0.35);
      fill.position.set(-3, 1, -2);
      scene.add(fill);

      const gltf = loaded.gltf;
      currentModel = gltf.scene;
      scene.add(currentModel);

      // Play embedded animations (flame, etc.)
      if (gltf.animations && gltf.animations.length > 0) {
        mixer = new THREE.AnimationMixer(currentModel);
        for (const clip of gltf.animations) {
          const action = mixer.clipAction(clip);
          action.reset();
          action.setLoop(THREE.LoopRepeat, Infinity);
          action.play();
        }
        controls.autoRotateSpeed = 0.6;
      }

      const box = new THREE.Box3().setFromObject(currentModel);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const scale = 1.4 / (Math.max(size.x, size.y, size.z) || 1);
      currentModel.scale.setScalar(scale);
      currentModel.position.copy(center).multiplyScalar(-scale); // center AFTER scaling

      camera.position.set(1.4, 1.1, 1.8);
      controls.target.set(0, 0, 0);
      controls.update();
    }
  } catch (err) {
    console.warn("3D viewer setup failed, fallback image", source, err);
    const img = fallbackImg;
    closeViewer();
    container.classList.remove("has-viewer");
    if (img) container.innerHTML = `<img src="${img}" alt="" />`;
    else container.textContent = "No 3D model";
    return;
  }

  const animate = () => {
    raf = requestAnimationFrame(animate);
    const dt = clock ? clock.getDelta() : 0;
    if (mixer) mixer.update(dt);
    if (bbModel) bbModel.update(dt); // flipbook textures
    controls?.update();
    renderer?.render(scene, camera);
  };
  animate();
}

window.addEventListener("resize", () => {
  if (!renderer || !host || !camera) return;
  const w = host.clientWidth;
  const h = host.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
});
